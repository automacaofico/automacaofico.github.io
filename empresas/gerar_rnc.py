"""Gera empresas/rnc.json a partir da "Base_Reg. 1 e 2_DDMM.xlsx".

Publica só contagens agregadas da Regional 1: títulos, descrições e nomes de pessoas
ficam de fora, porque o site é público.
Uso: python gerar_rnc.py "C:/caminho/Base_Reg. 1 e 2_2610.xlsx"
"""
import collections
import datetime
import json
import os
import re
import sys

import openpyxl

CANON = [('APIA', 'ÁPIA'), ('ATERPA', 'ATERPA'), ('EMPA ', 'EMPA'), ('SOMAFEL', 'SOMAFEL'), ('VALE', 'VALE'),
         ('GSA', 'GSA'), ('CIVIL MASTER', 'CIVIL MASTER'), ('SANCHES', 'SANCHES TRIPOLONI'), ('ABS', 'ABS'),
         ('CONPREM', 'CONPREM'), ('FRANCISCON', 'FRANCISCON'), ('TRATERRA', 'TRATERRA'), ('BRAZABE', 'BRAZABE'),
         ('MOLDI', 'MOLDI'), ('SOLO CENTROOESTE', 'SOLO CENTROOESTE'), ('ENGEFOTO', 'ENGEFOTO'),
         ('TUBOS TIGRE', 'TUBOS TIGRE'), ('H.F.', 'HF SISTEMAS DE FREIO'), ('BRAFER', 'BRAFER'),
         ('QUALIFY', 'QUALIFY'), ('CODEME', 'CODEME'), ('CORPLASTIK', 'CORPLASTIK'), ('EGIS', 'EGIS'),
         ('PEDREIRA URUA', 'PEDREIRA URUAÇU'), ('PEDREIRA ITAPACI', 'PEDREIRA ITAPACI'),
         ('BR RAILPARTS', 'BR RAILPARTS')]


def canon(nome):
    n = str(nome or '').strip().upper()
    for chave, valor in CANON:
        if n.startswith(chave) or chave.strip() in n.split(' - ')[0]:
            return valor
    return n or 'NÃO INFORMADA'


def grupo_pacote(p):
    t = str(p or '').strip().upper()
    if 'SUPERESTRUTURA' in t:
        return 'Superestrutura'
    m = re.fullmatch(r'PACOTE (\d)', t)
    return 'Pacote ' + m[1] if m else 'Vários pacotes'


def limpa(v, vazio):
    t = str(v if v is not None else '').strip()
    return vazio if t in ('', '-', '#N/A') else t


def main(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    nome_aba = max((n for n in wb.sheetnames if n.startswith('Atualiza')), key=lambda n: wb[n].max_row)
    linhas = wb[nome_aba].iter_rows(values_only=True)
    cab = [str(c).strip() if c is not None else '' for c in next(linhas)]
    col = {c: i for i, c in enumerate(cab)}
    cubo = collections.Counter()
    for r in linhas:
        if not r[0] or not str(r[0]).startswith('RNC') or str(r[col['Regional']]).strip() != 'Regional 1':
            continue
        status = str(r[col['STATUS DA RNC']]).strip().upper()
        aberta = status != 'ENCERRADA'
        cubo[(canon(r[col['Contratada']]), grupo_pacote(r[col['Pacote']]),
              str(r[col['Identificado por']]).strip().upper(), status,
              limpa(r[col['Grupo responsável']], 'Não informado') if aberta else '',
              limpa(r[col['Etapa']], 'Não informada') if aberta else '',
              limpa(r[col['Classificação da RNC']], 'Sem classificação'),
              limpa(r[col["Situação da RNC's"]], '') if aberta else '')] += 1
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{2,4})', nome_aba)
    ref = '%02d/%02d/20%s' % (int(m[1]), int(m[2]), m[3][-2:]) if m else ''
    saida = {'arquivo': os.path.basename(caminho), 'aba': nome_aba, 'dataRef': ref,
             'geradoEm': datetime.datetime.now().strftime('%d/%m/%Y %H:%M'),
             'campos': ['empresa', 'pacote', 'idPor', 'status', 'grupo', 'etapa', 'classif', 'situacao', 'n'],
             'linhas': sorted([*k, n] for k, n in cubo.items())}
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rnc.json')
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print(sum(cubo.values()), 'RNCs,', len(cubo), 'combinações ->', destino)


if __name__ == '__main__':
    main(sys.argv[1])
