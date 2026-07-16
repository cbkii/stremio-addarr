from pathlib import Path

p = Path('test/config-ui.test.ts')
text = p.read_text()
old = """test('manifest advertises Stremio configuration without making it mandatory', async () => {
  const cfg = uiConfig();"""
new = """test('manifest advertises Stremio configuration without making it mandatory', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  const cfg = uiConfig();"""
if text.count(old) != 1:
    raise RuntimeError(f'Expected one manifest configuration test fixture, found {text.count(old)}')
p.write_text(text.replace(old, new, 1))
