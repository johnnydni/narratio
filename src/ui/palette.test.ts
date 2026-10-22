import { describe, expect, it } from 'vitest';
import { matchScore } from './Palette';
import { keyPan, keyVariant } from '../audio/typewriter';

describe('Schnellsuche: Treffer-Güte', () => {
  it('bevorzugt Anfang vor Wortanfang vor Mitte vor verstreuten Buchstaben', () => {
    const start = matchScore('Zöllner', 'zoll');
    const word = matchScore('Der Zöllner', 'zoll');
    const mid = matchScore('Amtszöllner', 'zoll');
    const scattered = matchScore('Zentrale Halle', 'zhl');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(-1);
  });

  it('ignoriert Umlaute und ß, findet nichts Fremdes', () => {
    expect(matchScore('Der Zöllner', 'zollner')).toBeGreaterThan(0);
    expect(matchScore('Straße', 'strasse')).toBe(100);
    expect(matchScore('Nordtor', 'xyz')).toBe(-1);
  });
});

describe('Schreibmaschine: Tastenzuordnung', () => {
  it('gleiche Taste, gleicher Typenhebel; links liegt links', () => {
    expect(keyVariant('a', 14)).toBe(keyVariant('A', 14));
    expect(keyPan('q')).toBeLessThan(0);
    expect(keyPan('p')).toBeGreaterThan(0);
    expect(keyPan('€')).toBe(0);
  });
});
