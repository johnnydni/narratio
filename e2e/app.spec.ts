import { expect, test } from '@playwright/test';

const shots = process.env.SHOTS_DIR;

test('öffnet das Beispielprojekt und zeigt die Szene', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toHaveText('narratio');
  await expect(page.locator('.ProseMirror')).toContainText('Der Wind trug den Geruch');
  await expect(page.locator('.ProseMirror .ref').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/01-szene.png` });
});

test('P0-Gate: zwei Fenster gleichen Text, Lore und Dialog live ab', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/');
  await b.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Torverhör: Brann' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(8);
  await page.getByLabel('Spielstand für die Vorschau').selectOption({ label: 'Fremdenführerin, Stufe 2' });
  await page.waitForTimeout(400);
  if (shots) await page.screenshot({ path: `${shots}/07-dialog-dunkel.png` });
});

test('Lore, Weltzustand und Export', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
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
  await page.goto('/');
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
