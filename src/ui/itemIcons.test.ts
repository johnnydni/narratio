import { describe, expect, it } from 'vitest';
import { ICON_GROUPS } from './iconCatalog';
import { LORE_DEFAULT_ICON, loadIconCatalog, searchIcons } from './itemIcons';

describe('Icon-Bibliothek', () => {
  it('jedes Icon existiert, Namen sind eindeutig, Standards sind im Katalog', async () => {
    const { byName } = await loadIconCatalog();
    const all = ICON_GROUPS.flatMap((g) => g.icons);
    expect(all.length).toBeGreaterThan(150);
    expect(new Set(all.map((i) => i.name)).size).toBe(all.length);
    for (const i of all) expect(i.Icon, i.name).toBeTruthy();
    for (const name of Object.values(LORE_DEFAULT_ICON)) expect(byName.has(name), name).toBe(true);
  });

  it('sucht deutsch, englisch und ohne Umlaute', async () => {
    const cat = await loadIconCatalog();
    const searchIcons_ = (q: string) => searchIcons(cat, q);
    expect(searchIcons_('schwert')[0]?.name).toBe('Sword');
    expect(searchIcons_('castle').map((i) => i.name)).toContain('Castle');
    expect(searchIcons_('schaedel').map((i) => i.name)).toContain('Skull');
    expect(searchIcons_('trank').map((i) => i.name)).toEqual(expect.arrayContaining(['FlaskConical', 'FlaskRound']));
    expect(searchIcons_('')).toEqual([]);
    expect(searchIcons_('xyzzy')).toEqual([]);
  });
});
