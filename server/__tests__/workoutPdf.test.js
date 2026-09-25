/**
 * @jest-environment node
 */
const { parseWorkoutLines, parseSeries, parseRest, assignImages } = require('../ai/workoutPdf');

// Linhas como saem da ficha "H2- A" (x/y em pontos do PDF, y cresce para cima).
function lines(rows) {
  return rows.map(([y, x, text]) => ({ y, x, text, page: 1 }));
}

describe('parseSeries', () => {
  it('separa séries, repetições e observações', () => {
    expect(parseSeries('4x 8 a 10 rep (pegada semi-pronada)')).toEqual({ sets: 4, reps: '8 a 10', notes: ['pegada semi-pronada'] });
    expect(parseSeries('4x 10 a 12 rep. RESTPAUSE na última série (Pegada semi-pronada)'))
      .toEqual({ sets: 4, reps: '10 a 12', notes: ['Pegada semi-pronada', 'RESTPAUSE na última série'] });
    expect(parseSeries('4x 12 rep DROPSET na última série.')).toEqual({ sets: 4, reps: '12', notes: ['DROPSET na última série'] });
    expect(parseSeries('3x 10” iso + 12 rep')).toEqual({ sets: 3, reps: '10” iso + 12', notes: [] });
    expect(parseSeries('2x 30”')).toEqual({ sets: 2, reps: '30”', notes: [] });
    expect(parseSeries('4x 10 rep + rep. máx. (< carga)')).toEqual({ sets: 4, reps: '10 + máx', notes: ['< carga'] });
  });
});

describe('parseRest', () => {
  it('entende segundos e minutos', () => {
    expect(parseRest('90s')).toBe(90);
    expect(parseRest('1min30')).toBe(90);
    expect(parseRest('2 min')).toBe(120);
  });
});

describe('parseWorkoutLines', () => {
  const page = lines([
    [1379, 90, 'Mateus Henrique Sales de Souza'],
    [1360, 90, 'Rotina: Hipertrofia 02'],
    [1345, 90, ' Hipertrofia'],
    [1331, 90, ' Avançado'],
    [1273, 24, 'H2- A'],
    [1238, 43, 'Circundução de ombro c/ megaband'],
    [1218, 43, 'Séries: 2x 12 rep'],
    [1205, 43, 'Carga: Megaband preto'],
    [1191, 43, 'Intervalo: 10s'],
    [1125, 43, 'Alongamento de ombro c/ megaband na'],
    [1112, 43, 'grade'],
    [1092, 43, 'Séries: 2x 30”'],
    [1079, 43, 'Carga: 0kg'],
    [1032, 43, 'Supino reto com ht'],
    [1012, 43, 'Séries: 4x 8 a 10 rep (pegada semi-'],
    [999, 43, 'pronada)'],
    [986, 43, 'Carga: 18Kg'],
    [972, 43, 'Intervalo: 90s'],
  ]);

  it('lê rotina, nome da ficha e exercícios com títulos e campos em várias linhas', () => {
    const r = parseWorkoutLines(page);
    expect(r.routine).toBe('Hipertrofia 02');
    expect(r.planName).toBe('H2- A');
    expect(r.exercises.map((e) => e.name)).toEqual([
      'Circundução de ombro c/ megaband',
      'Alongamento de ombro c/ megaband na grade',
      'Supino reto com ht',
    ]);
    expect(r.exercises[0]).toMatchObject({ sets: 2, reps: '12', load: 'Megaband preto', restSeconds: 10 });
    expect(r.exercises[1]).toMatchObject({ sets: 2, reps: '30”', load: undefined, restSeconds: undefined });
    expect(r.exercises[2]).toMatchObject({ sets: 4, reps: '8 a 10', load: '18Kg', restSeconds: 90, notes: 'pegada semi-pronada' });
  });

  it('associa cada foto ao exercício ao lado dela e ignora a foto de perfil', () => {
    const { exercises } = parseWorkoutLines(page);
    const images = [
      { page: 1, x0: 20, x1: 65, y0: 1341, y1: 1386 }, // perfil, no cabeçalho
      { page: 1, x0: 235, x1: 281, y0: 1166, y1: 1248 }, // ao lado do 1º exercício
      { page: 1, x0: 235, x1: 281, y0: 960, y1: 1042 }, // ao lado do supino (o 2º não tem foto)
    ];
    const assigned = assignImages(exercises, images);
    expect([...assigned.keys()].sort()).toEqual([0, 2]);
    expect(assigned.get(0)).toBe(images[1]);
    expect(assigned.get(2)).toBe(images[2]);
  });

  it('devolve lista vazia quando o PDF não tem o formato de ficha', () => {
    expect(parseWorkoutLines(lines([[700, 40, 'Plano alimentar'], [680, 40, 'Café da manhã: ovos']])).exercises).toEqual([]);
  });
});
