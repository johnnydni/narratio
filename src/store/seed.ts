import * as Y from 'yjs';
import type { Project } from './project';
import { SCHEMA_VERSION } from './project';
import { dialogOutcomeKey } from '../model/types';
import { loreToken } from '../model/refs';

/**
 * Beispielprojekt "Aschenstadt" für den ersten Start. Feste IDs, damit zwei gleichzeitig
 * startende Fenster dieselben Einträge erzeugen statt Duplikate.
 */

type Inline = string | { ref: string };

function paragraph(parts: Inline[], nodeName = 'paragraph', attrs: Record<string, string | number> = {}): Y.XmlElement {
  const p = new Y.XmlElement(nodeName);
  for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v as string);
  const children = parts.map((part) => {
    if (typeof part === 'string') return new Y.XmlText(part);
    const el = new Y.XmlElement('loreRef');
    el.setAttribute('id', part.ref);
    return el;
  });
  p.insert(0, children);
  return p;
}

export function seedDemo(project: Project): void {
  project.transact(() => {
    project.setName('Aschenstadt');
    project.meta.set('schema', SCHEMA_VERSION);

    // Lore
    const lore = (id: string, loreKind: 'character' | 'place' | 'item' | 'faction' | 'quest', title: string, exportId: string, fields: Record<string, string>, description: string) =>
      project.createItem('lore', { loreKind, title, exportId, fields, description, parentId: null }, id);

    lore('l_mara', 'character', 'Mara', 'Char.Mara', { Rolle: 'Protagonistin', Herkunft: 'Salzküste' }, 'Reisende mit einer Klinge, über die sie nicht spricht.');
    lore('l_brann', 'character', 'Brann', 'Char.Brann', { Rolle: 'Zöllner am Nordtor', Haltung: 'misstrauisch' }, 'Kennt jeden, der durch das Tor kommt, und vergisst niemanden.');
    lore('l_ysa', 'character', 'Ysa', 'Char.Ysa', { Rolle: 'Händlerin' }, 'Handelt mit Salz und mit Gerüchten.');
    lore('l_nordtor', 'place', 'Nordtor', 'Place.Aschenstadt.Nordtor', { Region: 'Aschenstadt' }, 'Das einzige Tor, das nach dem Brand wieder aufgebaut wurde.');
    lore('l_unterstadt', 'place', 'Unterstadt', 'Place.Aschenstadt.Unterstadt', { Einwohner: '8.000' }, 'Notquartier der Schmiede und Salzhändler.');
    lore('l_klinge', 'item', 'Aschenklinge', 'Item.Waffe.Aschenklinge', { Seltenheit: 'Episch', Schaden: 'Feuer', Wert: '1.250', Anforderung: 'Schwertkampf ab 4' }, 'Geschmiedet im letzten Brand der Unterstadt. Die Klinge bleibt warm, solange ihre Trägerin lügt.');
    lore('l_wacht', 'faction', 'Aschenwacht', 'Faction.Aschenwacht', {}, 'Führt das Register aller, die tagsüber Eisen kaufen.');
    lore('l_salzspur', 'quest', 'Die Salzspur', 'Quest.Salzspur', { Phasen: '4' }, 'Mara folgt verschwundenen Salzkarawanen.');

    // Weltzustand
    project.putWorldVar({ id: 'v_salzspur', key: 'Quest.Salzspur.Phase', label: 'Salzspur: Phase', kind: 'questPhase', defaultValue: 0, loreId: 'l_salzspur' });
    project.putWorldVar({ id: 'v_guide', key: 'Perk.Fremdenfuehrer', label: 'Perk: Fremdenführer', kind: 'perk', defaultValue: false });
    project.putWorldVar({ id: 'v_intim', key: 'Skill.Einschuechtern', label: 'Skill: Einschüchtern', kind: 'skill', defaultValue: 1 });
    project.putWorldVar({ id: 'v_blade', key: 'Inventory.Aschenklinge', label: 'Besitzt Aschenklinge', kind: 'inventory', defaultValue: 1, loreId: 'l_klinge' });
    project.putWorldVar({ id: 'v_brann', key: 'Relation.Brann', label: 'Beziehung zu Brann', kind: 'number', defaultValue: 0, loreId: 'l_brann' });

    project.putProfile({ id: 'p_start', name: 'Neuer Spielstand', state: {} });
    project.putProfile({ id: 'p_guide', name: 'Fremdenführerin, Stufe 2', state: { v_guide: true } });
    project.putProfile({ id: 'p_mage', name: 'Magierin, Salzspur Phase 3', state: { v_salzspur: 3, v_intim: 4, [dialogOutcomeKey('d_ysa')]: 'Betrug aufgedeckt' } });

    // Manuskript
    project.createItem('folder', { title: 'Manuskript', parentId: null, order: 0 }, 'f_manu');
    project.createItem('folder', { title: 'Akt I: Ankunft', parentId: 'f_manu', order: 0 }, 'f_akt1');
    project.createItem('folder', { title: 'Kapitel 1: Das Tor', parentId: 'f_akt1', order: 0 }, 'f_kap1');
    project.createItem('scene', { title: 'Ankunft am Nordtor', parentId: 'f_kap1', order: 0, status: 'draft', synopsis: 'Mara erreicht das Nordtor und wird vom Zöllner Brann auf ihre Klinge angesprochen.' }, 's_ankunft');
    project.createItem('scene', { title: 'Der Zöllner', parentId: 'f_kap1', order: 1, status: 'idea', synopsis: 'Brann erinnert sich an Mara.' }, 's_zoellner');
    project.createItem('scene', { title: 'Erste Nacht', parentId: 'f_kap1', order: 2, status: 'idea' }, 's_nacht');

    const frag = project.sceneFragment('s_ankunft');
    if (frag.length === 0) {
      frag.insert(0, [
        paragraph(['Ankunft am Nordtor'], 'heading', { level: 1 }),
        paragraph(['Der Wind trug den Geruch von kaltem Rauch durch das ', { ref: 'l_nordtor' }, ', lange bevor ', { ref: 'l_mara' }, ' die ersten Türme sah. Hinter ihr ratterte der Karren des Salzhändlers, vor ihr hob sich die Stadt aus dem Grau wie etwas, das nie ganz gelöscht worden war.']),
        paragraph([{ ref: 'l_brann' }, ', der Zöllner, lehnte am Torpfosten und musterte die Klinge an ihrem Gürtel. „Die ', { ref: 'l_klinge' }, '“, sagte er. „Die trägt man hier nicht offen.“']),
        paragraph(['Mara legte die Hand auf den Griff. Sie wusste, wie viele Antworten es auf diesen Satz gab, und dass jede etwas kostete.']),
      ]);
    }

    // Dialoge
    project.createItem('folder', { title: 'Dialoge', parentId: null, order: 1 }, 'f_dialoge');
    project.createItem('dialog', { title: 'Torverhör: Brann', parentId: 'f_dialoge', order: 0, exportId: 'Dialog.Torverhoer.Brann', status: 'draft' }, 'd_tor');
    project.createItem('dialog', { title: 'Handel: Ysa', parentId: 'f_dialoge', order: 1, exportId: 'Dialog.Handel.Ysa', status: 'idea' }, 'd_ysa');

    const d = 'd_tor';
    project.putNode(d, { id: 'n_start', type: 'start', x: 0, y: 120 });
    project.putNode(d, {
      id: 'n_halt', type: 'line', x: 140, y: 60, speakerId: 'l_brann',
      variants: [{ id: 'va0', priority: 1, condition: null, text: '„Halt!“', direction: 'Hebt die Hand, ohne aufzusehen.' }],
    });
    project.putNode(d, {
      id: 'n_greet', type: 'line', x: 520, y: 20, speakerId: 'l_brann',
      variants: [
        { id: 'va1', priority: 1, condition: { type: 'compare', varId: 'v_guide', op: '==', value: true }, text: '„Ihr kennt die Regeln, Reisende. Zoll zahlen, dann geht durch.“' },
        {
          id: 'va2', priority: 2,
          condition: { type: 'and', items: [
            { type: 'compare', varId: 'v_salzspur', op: '>=', value: 2 },
            { type: 'dialogOutcome', dialogId: 'd_ysa', outcome: 'Betrug aufgedeckt' },
          ] },
          text: '„Du schon wieder. Der Hauptmann fragt nach dir.“',
        },
        { id: 'va3', priority: 3, condition: null, text: `„Halt. Was führt dich nach Aschenstadt?“ Sein Blick bleibt an der ${loreToken('l_klinge')} hängen.` },
      ],
    });
    project.putNode(d, {
      id: 'n_choice', type: 'choice', x: 140, y: 400,
      options: [
        { id: 'o_show', text: `Die ${loreToken('l_klinge')} offen zeigen.`, condition: { type: 'compare', varId: 'v_blade', op: '>=', value: 1 }, effects: [{ id: 'ef1', varId: 'v_salzspur', mode: 'set', value: 3 }] },
        { id: 'o_pay', text: 'Zoll zahlen und weitergehen.', condition: null, effects: [] },
        { id: 'o_stare', text: 'Schweigen und starren.', condition: { type: 'compare', varId: 'v_intim', op: '>=', value: 3 }, effects: [{ id: 'ef2', varId: 'v_brann', mode: 'add', value: -1 }] },
      ],
    });
    project.putNode(d, {
      id: 'n_respect', type: 'line', x: 600, y: 380, speakerId: 'l_brann',
      variants: [{ id: 'va4', priority: 1, condition: null, text: '„Dann geh. Und lass sie in der Scheide, solange du in meiner Stadt bist.“' }],
    });
    project.putNode(d, { id: 'n_end_ok', type: 'end', x: 1000, y: 400, outcome: 'Durchgelassen' });
    project.putNode(d, { id: 'n_jump', type: 'jump', x: 600, y: 560, targetDialogId: 'd_ysa' });
    project.putNode(d, { id: 'n_end_stare', type: 'end', x: 600, y: 680, outcome: 'Abgewiesen' });

    const e = (id: string, source: string, target: string, sourceHandle?: string) =>
      project.putEdge(d, { id, source, target, sourceHandle: sourceHandle ?? null });
    e('e1', 'n_start', 'n_halt');
    e('e2', 'n_halt', 'n_greet');
    e('e3', 'n_greet', 'n_choice');
    e('e4', 'n_choice', 'n_respect', 'o_show');
    e('e5', 'n_respect', 'n_end_ok');
    e('e6', 'n_choice', 'n_jump', 'o_pay');
    e('e7', 'n_choice', 'n_end_stare', 'o_stare');

    project.putNode('d_ysa', { id: 'y_start', type: 'start', x: 0, y: 100 });
    project.putNode('d_ysa', {
      id: 'y_line', type: 'line', x: 160, y: 60, speakerId: 'l_ysa',
      variants: [
        { id: 'yv1', priority: 1, condition: { type: 'compare', varId: 'v_blade', op: '>=', value: 1 }, text: `„Für eine ${loreToken('l_klinge')} mache ich dir einen besonderen Preis.“` },
        { id: 'yv2', priority: 2, condition: null, text: '„Salz, Seile, Neuigkeiten. Was darf es sein?“' },
      ],
    });
    project.putNode('d_ysa', {
      id: 'y_choice', type: 'choice', x: 160, y: 300,
      options: [
        { id: 'yo1', text: 'Handeln.', condition: null, effects: [] },
        { id: 'yo2', text: 'Den gefälschten Salzstempel ansprechen.', condition: null, effects: [{ id: 'yef1', varId: 'v_salzspur', mode: 'set', value: 2 }] },
      ],
    });
    project.putNode('d_ysa', { id: 'y_end1', type: 'end', x: 600, y: 260, outcome: 'Handel abgeschlossen' });
    project.putNode('d_ysa', { id: 'y_end2', type: 'end', x: 600, y: 380, outcome: 'Betrug aufgedeckt' });
    project.putEdge('d_ysa', { id: 'ye1', source: 'y_start', target: 'y_line', sourceHandle: null });
    project.putEdge('d_ysa', { id: 'ye2', source: 'y_line', target: 'y_choice', sourceHandle: null });
    project.putEdge('d_ysa', { id: 'ye3', source: 'y_choice', target: 'y_end1', sourceHandle: 'yo1' });
    project.putEdge('d_ysa', { id: 'ye4', source: 'y_choice', target: 'y_end2', sourceHandle: 'yo2' });

    project.meta.set('seeded', true);
  });
}
