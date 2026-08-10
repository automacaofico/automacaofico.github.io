package io.github.automacaofico.tracker;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Button;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    private static final int PERMISSIONS = 41;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView title, detail, lastGps, lastSend, queueCount;
    private Button start, stop;
    private final Runnable refresh = new Runnable() { @Override public void run() { render(); handler.postDelayed(this, 1000); } };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); setContentView(R.layout.activity_main);
        title=findViewById(R.id.stateTitle); detail=findViewById(R.id.stateDetail); lastGps=findViewById(R.id.lastGps); lastSend=findViewById(R.id.lastSend); queueCount=findViewById(R.id.queueCount); start=findViewById(R.id.startButton); stop=findViewById(R.id.stopButton);
        start.setOnClickListener(v -> requestAndStart()); stop.setOnClickListener(v -> { stopService(new Intent(this, TrackingService.class)); getSharedPreferences("tracker",MODE_PRIVATE).edit().putBoolean("running",false).apply(); render(); });
    }
    @Override protected void onResume() { super.onResume(); handler.post(refresh); }
    @Override protected void onPause() { super.onPause(); handler.removeCallbacks(refresh); }

    private void requestAndStart() {
        if (BuildConfig.DEVICE_TOKEN.isEmpty()) { detail.setText("Este APK não possui a credencial do NTC001. Solicite uma nova compilação."); return; }
        String[] permissions = Build.VERSION.SDK_INT >= 33 ? new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.POST_NOTIFICATIONS} : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) ActivityCompat.requestPermissions(this, permissions, PERMISSIONS); else startTracking();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == PERMISSIONS && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) startTracking(); else detail.setText("A localização precisa é necessária para calcular o KM ferroviário.");
    }
    private void startTracking() {
        ContextCompat.startForegroundService(this, new Intent(this, TrackingService.class));
        getSharedPreferences("tracker",MODE_PRIVATE).edit().putBoolean("running",true).apply(); render();
        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }
    private void render() {
        SharedPreferences p=getSharedPreferences("tracker",MODE_PRIVATE); boolean running=p.getBoolean("running",false);
        title.setText(running ? "Transmitindo NTC001" : "Rastreamento parado");
        detail.setText(running ? "O GPS é coletado a cada 5 segundos. Mantenha este aparelho ligado e conectado à Starlink." : "Toque em iniciar e mantenha o celular ligado à Starlink do equipamento.");
        start.setVisibility(running ? Button.GONE : Button.VISIBLE); stop.setVisibility(running ? Button.VISIBLE : Button.GONE);
        lastGps.setText("GPS: " + p.getString("lastGps","aguardando")); lastSend.setText("Servidor: " + p.getString("lastSend","nenhum envio")); queueCount.setText("Fila offline: " + p.getInt("queue",0) + " posições");
    }
}
