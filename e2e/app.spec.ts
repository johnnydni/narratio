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
