import { dashboardById } from './schemas.js';
import { AppError, publicError } from './errors.js';
import { DriveStore } from './google-drive.js';
import { GitHubPublisher } from './github.js';
import { VersionService } from './version-service.js';

function json(body, status = 200) {
  return Response.json(body, { status });
}

export class VersionCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.tail = Promise.resolve();
  }

  service(dashboardId) {
    const dashboard = dashboardById(dashboardId);
    if (!dashboard) throw new AppError('Dashboard desconhecido.', 404, 'DASHBOARD_NOT_FOUND');
    return new VersionService({
      drive: new DriveStore(this.env),
      github: new GitHubPublisher(this.env),
      dashboard,
      maxBytes: Number(this.env.MAX_FILE_BYTES || 10485760)
    });
  }

  serialize(task) {
    const run = this.tail.catch(() => null).then(task);
    this.tail = run.catch(() => null);
    return run;
  }

  async rateLimit(request) {
    const { limit, windowSeconds } = await request.json();
    const now = Date.now();
    return this.ctx.storage.transaction(async (transaction) => {
      const state = (await transaction.get('rate')) || { count: 0, resetAt: now + windowSeconds * 1000 };
      if (state.resetAt <= now) {
        state.count = 0;
        state.resetAt = now + windowSeconds * 1000;
      }
      state.count += 1;
      await transaction.put('rate', state);
      return json({ allowed: state.count <= limit, remaining: Math.max(0, limit - state.count), resetAt: state.resetAt }, state.count <= limit ? 200 : 429);
    });
  }

  async upload(request) {
    const form = await request.formData();
    const dashboardId = form.get('dashboard');
    const file = form.get('file');
    const user = String(form.get('user') || 'operador');
    if (!(file instanceof File)) throw new AppError('Arquivo não recebido.', 422, 'FILE_REQUIRED');
    const buffer = await file.arrayBuffer();
    return json(await this.service(dashboardId).update({ file, buffer, user }));
  }

  async restore(request) {
    const body = await request.json();
    return json(await this.service(body.dashboard).restore(body.versionId, body.user || 'operador'));
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/internal/rate') return this.rateLimit(request);
      if (path === '/internal/upload') return await this.serialize(() => this.upload(request));
      if (path === '/internal/restore') return await this.serialize(() => this.restore(request));
      return json({ ok: false, error: 'Rota interna inexistente.' }, 404);
    } catch (error) {
      const result = publicError(error);
      return json(result.body, result.status);
    }
  }
}
