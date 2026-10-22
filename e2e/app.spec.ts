import { expect, test } from '@playwright/test';

const shots = process.env.SHOTS_DIR;

test('öffnet das Beispielprojekt und zeigt die Szene', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.wordmark')).toHaveText('narratio');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug den Geruch');
  await expect(page.locator('.ProseMirror .ref').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/01-szene.png` });
});

test('P0-Gate: zwei Fenster gleichen Text, Lore und Dialog live ab', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/#/p/default');
  await b.goto('/#/p/default');
  await expect(a.locator('.ProseMirror')).toContainText('Der Wind');
  await expect(b.locator('.ProseMirror')).toContainText('Der Wind');
  await expect(a.getByTestId('sync-status')).toContainText('2 Fenster verbunden');

  // Fenster A schreibt ans Ende, Fenster B schreibt gleichzeitig an den Anfang des letzten Absatzes.
  await a.locator('.ProseMirror p').last().click();
  await a.keyboard.press('End');
  await b.locator('.ProseMirror p').last().click();
  await b.keyboard.press('Home');
  await Promise.all([
    a.keyboard.type(' Fenster A war hier.', { delay: 15 }),
    b.keyboard.type('Fenster B zuerst. ', { delay: 15 }),
  ]);
  for (const p of [a, b]) {
    await expect(p.locator('.ProseMirror')).toContainText('Fenster A war hier.');
    await expect(p.locator('.ProseMirror')).toContainText('Fenster B zuerst.');
  }

  // Nach dem Tippen ist die Oberfläche ausgeblendet; eine Mausbewegung holt sie zurück.
  await a.mouse.move(50, 50);
  await a.mouse.move(400, 400);
  await expect(a.locator('html')).not.toHaveClass(/immersed/);

  // Umbenennen eines Lore-Eintrags in A wirkt sofort im Text in B (LR-04).
  await a.getByRole('button', { name: 'Aschenklinge', exact: true }).click();
  const title = a.getByLabel('Name', { exact: true });
  await title.fill('Glutklinge');
  await title.blur();
  await expect(b.locator('.ProseMirror')).toContainText('Glutklinge');

  // Nach dem Neuladen ist alles noch da (IndexedDB).
  await b.reload();
  await b.getByRole('navigation').getByRole('button', { name: /Ankunft am Nordtor/ }).click();
  await expect(b.locator('.ProseMirror')).toContainText('Fenster A war hier.');
  await expect(b.locator('.ProseMirror')).toContainText('Glutklinge');
  await context.close();
});

test('Dialog: Varianten, Vorschau mit Spielstand und Prüfung', async ({ page }) => {
  await page.goto('/#/p/default');
  await page.getByRole('button', { name: 'Torverhör: Brann' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await page.getByLabel('Spielstand für die Vorschau').selectOption({ label: 'Magierin, Salzspur Phase 3' });
  await page.locator('.react-flow__node').filter({ hasText: '3 Varianten' }).click();
  await expect(page.locator('.inspector')).toContainText('Variante 2 greift');
  await expect(page.locator('.inspector')).toContainText('Salzspur: Phase mindestens 2 (aktuell: 3)');
  if (shots) await page.screenshot({ path: `${shots}/02-dialog.png` });
});

test('Dunkles Design', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/p/default');
  await page.getByRole('button', { name: 'Torverhör: Brann' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await page.getByLabel('Spielstand für die Vorschau').selectOption({ label: 'Fremdenführerin, Stufe 2' });
  await page.waitForTimeout(400);
  if (shots) await page.screenshot({ path: `${shots}/07-dialog-dunkel.png` });
});

test('Lore, Weltzustand und Export', async ({ page }) => {
  await page.goto('/#/p/default');
  await page.getByRole('button', { name: 'Aschenklinge', exact: true }).click();
  await expect(page.locator('.uses')).toContainText('Torverhör: Brann');
  if (shots) await page.screenshot({ path: `${shots}/03-lore.png` });
  await page.getByRole('button', { name: 'Weltzustand', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Weltzustand' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/04-welt.png`, fullPage: true });
  await page.getByRole('button', { name: 'Prüfen und exportieren' }).click();
  await expect(page.locator('.sheet')).toContainText('Bereit für Unreal');
  await expect(page.getByTestId('export-preview')).toContainText('"format": "narratio.unreal"');
  if (shots) await page.screenshot({ path: `${shots}/05-export.png` });
});

test('Immersion: Schreiben blendet die Oberfläche aus, Mausbewegung holt sie zurück', async ({ page }) => {
  await page.goto('/#/p/default');
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Sie atmete durch und ging weiter.', { delay: 20 });
  await expect(page.locator('html')).toHaveClass(/immersed/);
  await page.waitForTimeout(1500);
  if (shots) await page.screenshot({ path: `${shots}/06-eingetaucht.png` });
  await page.mouse.move(100, 100);
  await page.mouse.move(400, 300);
  await expect(page.locator('html')).not.toHaveClass(/immersed/);
});

test('Sicherung: ZIP herunterladen, Text ändern, wiederherstellen', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug');
  await page.getByRole('button', { name: 'Prüfen und exportieren' }).click();

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sicherung herunterladen' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^Aschenstadt_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.zip$/);
  const zipPath = await dl.path();

  // Szene verändern …
  await page.getByRole('navigation').getByRole('button', { name: /Ankunft am Nordtor/ }).click();
  await page.locator('.ProseMirror p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Nach der Sicherung geschrieben.');
  await expect(page.locator('.ProseMirror')).toContainText('Nach der Sicherung geschrieben.');

  // … und die Sicherung wieder einlesen. Nach dem Tippen ist die Oberfläche ausgeblendet.
  await page.mouse.move(50, 50);
  await page.mouse.move(400, 400);
  await expect(page.locator('html')).not.toHaveClass(/immersed/);
  await page.getByRole('button', { name: 'Prüfen und exportieren' }).click();
  await page.getByTestId('backup-file').setInputFiles(zipPath);
  await expect(page.getByRole('alertdialog')).toContainText('ersetzt den aktuellen Stand');
  await page.getByRole('button', { name: 'Wiederherstellen', exact: true }).first().click();
  await expect(page.getByTestId('backup-message')).toContainText('wiederhergestellt');
  await expect(page.getByTestId('backup-list')).toContainText('vor dem Wiederherstellen');
  if (shots) await page.screenshot({ path: `${shots}/07-sicherung.png`, fullPage: true });

  await page.getByRole('navigation').getByRole('button', { name: /Ankunft am Nordtor/ }).click();
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug');
  await expect(page.locator('.ProseMirror')).not.toContainText('Nach der Sicherung geschrieben.');
});

/** Erzeugt im Browser ein PNG in der gewünschten Größe und Farbe. */
async function makePng(page: import('@playwright/test').Page, w: number, h: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    ([w, h, color]) => {
      const c = document.createElement('canvas');
      c.width = w as number;
      c.height = h as number;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = color as string;
      ctx.fillRect(0, 0, w as number, h as number);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(10, 10, 40, 40);
      return c.toDataURL('image/png').split(',')[1]!;
    },
    [w, h, color] as const,
  );
  return Buffer.from(b64, 'base64');
}

test('Medien: importieren, Duplikat erkennen, Vorschau, Unterschrift, Papierkorb', async ({ page }) => {
  await page.goto('/#/p/default');
  await page.getByRole('button', { name: 'Medien', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Medien' })).toBeVisible();

  const tor = await makePng(page, 2400, 1600, '#8a7f6c');
  const karte = await makePng(page, 800, 1200, '#5f7f73');
  await page.getByTestId('media-file').setInputFiles([
    { name: 'nordtor_konzept.png', mimeType: 'image/png', buffer: tor },
    { name: 'unterstadt_karte.png', mimeType: 'image/png', buffer: karte },
    { name: 'nordtor_kopie.png', mimeType: 'image/png', buffer: tor },
  ]);
  await expect(page.getByTestId('media-status')).toHaveText('2 Dateien importiert, 1 schon vorhanden.');
  const tiles = page.getByTestId('media-grid').locator('img');
  await expect(tiles).toHaveCount(2);

  // Die Galerie zeigt Vorschaubilder (höchstens 480 px), nicht das 2400-px-Original.
  await expect.poll(() => tiles.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const widths = await tiles.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth));
  expect(Math.max(...widths)).toBeLessThanOrEqual(480);

  // Einfügen aus der Zwischenablage
  const gelb = await makePng(page, 300, 300, '#c8a040');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'eingefuegt.png', { type: 'image/png' }));
    document.querySelector('.media-view')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  }, gelb.toString('base64'));
  await expect(tiles).toHaveCount(3);

  // Ansicht, Bildunterschrift
  await page.getByTitle('unterstadt_karte.png').click();
  await expect(page.getByRole('dialog')).toContainText('800 × 1200 px');
  await page.getByLabel('Bildunterschrift').fill('Karte der Salzwege');
  if (shots) await page.screenshot({ path: `${shots}/08-medium.png` });
  await page.keyboard.press('Escape');

  // Bleibt nach Neuladen erhalten
  await page.reload();
  await page.getByRole('button', { name: 'Medien', exact: true }).click();
  await expect(page.getByTestId('media-grid').locator('img')).toHaveCount(3);
  if (shots) await page.screenshot({ path: `${shots}/09-medien.png` });
  await page.getByTitle('unterstadt_karte.png').click();
  await expect(page.getByLabel('Bildunterschrift')).toHaveValue('Karte der Salzwege');

  await page.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(page.getByTestId('media-grid').locator('img')).toHaveCount(2);
  await page.getByRole('tab', { name: /Papierkorb/ }).click();
  await expect(page.getByTestId('media-grid').locator('img')).toHaveCount(1);
});

test('Bilder im Text und Zuordnung zu Szene und Lore', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug den Geruch');
  await page.locator('.ProseMirror p').first().click();
  await page.mouse.move(200, 200);

  // Bild über die Werkzeugleiste in den Text einfügen
  const esse = await makePng(page, 1600, 900, '#9a5a3a');
  await page.getByRole('button', { name: /Bild/ }).click();
  await page.getByTestId('picker-file').setInputFiles({ name: 'esse.png', mimeType: 'image/png', buffer: esse });
  const figure = page.locator('.ProseMirror figure.scene-figure');
  await expect(figure).toHaveCount(1);
  // Der Absatz bleibt ganz, das Bild steht dahinter (nach Überschrift und erstem Absatz).
  await expect(page.locator('.ProseMirror p').first()).toContainText('vor ihr hob sich die Stadt aus dem Grau');
  expect(await figure.evaluate((f) => [...f.closest('.ProseMirror')!.children].findIndex((c) => c.contains(f)))).toBe(2);
  await expect.poll(() => figure.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  if (shots) await page.screenshot({ path: `${shots}/10-bild-im-text.png` });

  // Die Auswahl aus der Werkzeugleiste ist vollständig sichtbar und klickbar (nicht von der Leiste abgeschnitten).
  await page.mouse.move(250, 250);
  await page.getByRole('button', { name: /Bild/ }).click();
  const picker = page.getByRole('dialog', { name: 'Medium wählen' });
  const box = (await picker.boundingBox())!;
  expect(box.height).toBeGreaterThan(80);
  if (shots) await page.screenshot({ path: `${shots}/10b-bildauswahl.png` });
  await picker.getByTitle('esse.png').click();
  await expect(figure).toHaveCount(2);

  // Dasselbe Bild der Szene zuordnen
  await page.mouse.move(300, 300);
  await page.getByRole('button', { name: 'Medium zuordnen' }).click();
  await page.getByRole('dialog', { name: 'Medium wählen' }).getByTitle('esse.png').click();
  await expect(page.getByTestId('scene-media').locator('img')).toHaveCount(1);

  // Einem Lore-Eintrag zuordnen
  await page.getByRole('button', { name: 'Aschenklinge', exact: true }).click();
  await page.getByRole('button', { name: '+ Medium zuordnen' }).click();
  await page.getByRole('dialog', { name: 'Medium wählen' }).getByTitle('esse.png').click();
  await expect(page.getByTestId('lore-media').locator('figure')).toHaveCount(1);

  // Medienansicht zeigt, wo das Bild verwendet wird; bleibt nach Neuladen erhalten.
  // Kurz warten: IndexedDB schreibt asynchron, ein sofortiges Neuladen kann die letzte Änderung abbrechen.
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole('button', { name: 'Medien', exact: true }).click();
  await page.getByTitle('esse.png').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('im Text');
  await expect(dialog).toContainText('Aschenklinge');
  if (shots) await page.screenshot({ path: `${shots}/11-verwendet-in.png` });
});

test('Startbildschirm, Schnellsuche und Meldung mit Rückgängig', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('#splash')).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug den Geruch');

  // Strg/Cmd+K öffnet die Schnellsuche, Tippen filtert, Enter springt
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Schnellsuche' });
  await expect(palette).toBeVisible();
  await expect(palette.locator('.palette-group').first()).toHaveText('Zuletzt geöffnet');
  await page.keyboard.type('zollner');
  await expect(palette.locator('.palette-item').first()).toContainText('Der Zöllner');
  if (shots) await page.screenshot({ path: `${shots}/12-schnellsuche.png` });
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('.crumbs .path')).toContainText('Der Zöllner');

  // Befehl über die Schnellsuche
  await page.getByRole('button', { name: 'Schnellsuche' }).click();
  await page.keyboard.type('medien');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Medien' })).toBeVisible();

  // Papierkorb mit Rückgängig
  const bild = await makePng(page, 400, 300, '#7a6a5a');
  await page.getByTestId('media-file').setInputFiles({ name: 'probe.png', mimeType: 'image/png', buffer: bild });
  await page.getByTitle('probe.png').click();
  await page.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(page.getByTestId('toast')).toContainText('liegt im Papierkorb');
  await expect(page.getByTestId('media-grid')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('media-grid').locator('img')).toHaveCount(1);
});

test('Bibliothek: Regal, neues Buch anlegen, aufschlagen, zurück, Papierkorb', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Deine Bibliothek' })).toBeVisible();
  // Beim ersten Start steht das Beispielprojekt im Regal
  await expect(page.getByTestId('book')).toHaveCount(1);
  await expect(page.getByTestId('book').first()).toHaveAttribute('aria-label', 'Aschenstadt');
  if (shots) await page.screenshot({ path: `${shots}/13-bibliothek.png` });

  await page.getByRole('button', { name: 'Neues Buch' }).click();
  await page.getByLabel('Titel des neuen Projekts').fill('Die Salzkrone');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await expect(page.getByTestId('book')).toHaveCount(2);
  await expect(page.getByTestId('book-details')).toContainText('Die Salzkrone');
  if (shots) await page.screenshot({ path: `${shots}/14-buch-gewaehlt.png` });

  await page.getByRole('button', { name: 'Aufschlagen' }).click();
  await expect(page).toHaveURL(/#\/p\/\w+/);
  await expect(page.locator('.crumbs .path')).toContainText('Erste Szene');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Salz auf den Lippen.');
  await page.waitForTimeout(300);

  // Das Wortzeichen führt zurück (nach dem Tippen erst die Maus bewegen: Immersion); das Beispielprojekt ist unberührt
  await page.mouse.move(100, 100);
  await page.mouse.move(400, 300);
  await expect(page.locator('html')).not.toHaveClass(/immersed/);
  await page.locator('.wordmark').click();
  await expect(page.getByRole('heading', { name: 'Deine Bibliothek' })).toBeVisible();
  await page.getByRole('button', { name: 'Aschenstadt' }).click();
  await page.getByRole('button', { name: 'Aufschlagen' }).click();
  await expect(page.locator('.ProseMirror')).not.toContainText('Salz auf den Lippen');
  await page.goBack();
  await page.goBack();
  await expect(page.locator('.ProseMirror')).toContainText('Salz auf den Lippen');

  // Papierkorb mit Rückgängig
  await page.locator('.wordmark').click();
  await page.getByRole('button', { name: 'Die Salzkrone' }).click();
  await page.getByRole('button', { name: 'In den Papierkorb' }).click();
  await expect(page.getByTestId('book')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.getByTestId('book')).toHaveCount(2);
});

test('Seitenleisten lassen sich ein- und ausklappen', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind');
  const binder = page.locator('.binder');
  await expect(binder).toBeVisible();
  await page.getByRole('button', { name: 'Linke Leiste' }).click();
  await expect(page.locator('.app')).toHaveClass(/left-hidden/);
  await page.getByRole('button', { name: 'Rechte Leiste' }).click();
  await expect(page.locator('.app')).toHaveClass(/right-hidden/);
  if (shots) await page.screenshot({ path: `${shots}/15-leisten-zu.png` });
  // bleibt nach dem Neuladen so
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/left-hidden/);
  await page.keyboard.press('ControlOrMeta+Alt+KeyB');
  await expect(page.locator('.app')).not.toHaveClass(/left-hidden/);
});

test('Icon-Bibliothek: Icon und Farbe für Einträge wählen', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind');
  const binder = page.locator('.binder');
  const picker = page.getByRole('dialog', { name: 'Icon wählen' });

  // Lore-Eintrag: Knopf neben der Art öffnet die Bibliothek, Suche auf Deutsch, Enter nimmt den ersten Treffer
  await binder.getByRole('button', { name: 'Aschenklinge' }).click();
  await page.locator('.lore').getByRole('button', { name: 'Icon wählen' }).click();
  await expect(picker).toBeVisible();
  await picker.getByLabel('Icon suchen').fill('schwert');
  if (shots) await page.screenshot({ path: `${shots}/16-icon-suche.png` });
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(binder.getByRole('button', { name: 'Aschenklinge' }).locator('svg.lucide-sword')).toBeVisible();

  // Rechtsklick im Projektbaum, Farbe wählen, bleibt nach dem Neuladen
  await binder.getByRole('button', { name: 'Ankunft am Nordtor' }).click({ button: 'right' });
  await expect(picker).toBeVisible();
  await picker.getByRole('radio', { name: 'Rot' }).click();
  await picker.locator('[data-icon="Castle"]').click();
  await expect(binder.getByRole('button', { name: 'Ankunft am Nordtor' }).locator('svg.lucide-castle')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/17-icons-baum.png` });
  await page.waitForTimeout(300);
  await page.reload();
  await expect(binder.getByRole('button', { name: 'Ankunft am Nordtor' }).locator('svg.lucide-castle')).toBeVisible();
  await expect(binder.getByRole('button', { name: 'Aschenklinge' }).locator('svg.lucide-sword')).toBeVisible();

  // Zurück auf Standard
  await binder.getByRole('button', { name: 'Ankunft am Nordtor' }).click({ button: 'right' });
  await picker.getByRole('button', { name: 'Standard' }).click();
  await expect(binder.getByRole('button', { name: 'Ankunft am Nordtor' }).locator('svg.lucide-castle')).toHaveCount(0);
});

test('Einstellungen: Darstellung wirkt sofort, Klang bleibt mit der Kopfleiste gleich', async ({ page }) => {
  await page.goto('/#/p/default');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind');
  await page.keyboard.press('Control+Comma');
  const dialog = page.getByTestId('settings');
  await expect(dialog).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/settings-darstellung.png` });

  // Textgröße und Schrift landen als Variablen am Dokument und damit im Editor
  await dialog.getByLabel('Textgröße').fill('22');
  await dialog.getByRole('radio', { name: 'Inter' }).click();
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-size', '22px');
  await dialog.getByRole('radio', { name: 'Dunkel' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dialog.getByRole('radio', { name: 'Wie System' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  // Klang im Menü abschalten: das Kopfhörer-Popover sieht es ohne Neuladen
  await dialog.getByRole('button', { name: 'Klang' }).click();
  await dialog.getByRole('checkbox').first().uncheck();
  if (shots) await page.screenshot({ path: `${shots}/settings-klang.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Klang beim Schreiben' }).click();
  await expect(page.locator('.ambient-pop input[type=checkbox]').first()).not.toBeChecked();

  // Nach dem Neuladen bleibt alles
  await page.reload();
  await expect(page.locator('.ProseMirror')).toHaveCSS('font-size', '22px');

  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await dialog.getByRole('button', { name: 'Sicherung und Speicher' }).click();
  await expect(dialog.getByTestId('settings-persisted')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/settings-speicher.png` });
  await dialog.getByRole('button', { name: 'Tastenkürzel' }).click();
  if (shots) await page.screenshot({ path: `${shots}/settings-kuerzel.png` });
});

test('Einstellungen gelten in allen Fenstern, die Ansicht bleibt je Fenster', async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/#/p/default');
  await b.goto('/#/p/default');
  await expect(b.locator('.ProseMirror')).toContainText('Der Wind');
  await a.keyboard.press('Control+Comma');
  await a.getByTestId('settings').getByRole('radio', { name: 'Breit' }).click();
  await expect(b.locator('.page').first()).toHaveCSS('max-width', '800px');
  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'Torverhör: Brann' }).click();
  await expect(a.locator('.react-flow__node').first()).toBeVisible();
  await expect(b.locator('.ProseMirror')).toContainText('Der Wind');
  await context.close();
});
