// UI-only placement helpers: SVG coordinates are transformed to real pointer coordinates.
export async function pointOnPlan(page, x, z, click = false) {
  const point = await page.locator('.plan-panel svg.plan-svg').evaluate(
    (svg, [x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
      return { x: p.x, y: p.y };
    },
    [x, z],
  );
  await page.mouse.move(point.x, point.y);
  if (click) await page.mouse.click(point.x, point.y);
}
export async function confirmSteelWorkplane(page) {
  await page.getByRole('button', { name: 'この平面でラインを描く', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.steelWorkplanePhase === 'draw',
  );
}
export async function beginSteelLineDrawing(page) {
  await page.getByRole('button', { name: '作業平面を配置', exact: true }).click();
  await confirmSteelWorkplane(page);
}
export async function openWorkplaneCoordinates(page) {
  if (!(await page.locator('.workplane-coordinates').evaluate((details) => details.open)))
    await page.locator('.workplane-coordinates summary').click();
}
export async function placeOnPlan(page, title, x, z) {
  const previousView = (await page.locator('.view-modes button.active').innerText()).trim();
  await page.getByRole('button', { name: '平面', exact: true }).click();
  await page.getByRole('button', { name: `${title}を配置`, exact: true }).click();
  await pointOnPlan(page, x, z);
  await page.waitForFunction(
    () => document.querySelector('.scene-host').dataset.previewValid === 'true',
  );
  await pointOnPlan(page, x, z, true);
  await page.locator('.placement-banner').waitFor({ state: 'hidden' });
  if (previousView !== '平面')
    await page.getByRole('button', { name: previousView, exact: true }).click();
}
export async function storedProject(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('ma-exhibition-v1', 1);
        req.onsuccess = () => {
          const db = req.result,
            get = db.transaction('projects').objectStore('projects').get('current');
          get.onsuccess = () => {
            resolve(get.result);
            db.close();
          };
          get.onerror = () => {
            reject(get.error);
            db.close();
          };
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
export async function waitProject(page, predicate) {
  for (let i = 0; i < 100; i++) {
    const p = await storedProject(page);
    if (p && predicate(p)) return p;
    await page.waitForTimeout(100);
  }
  throw new Error('保存データが期待する状態になりませんでした');
}
