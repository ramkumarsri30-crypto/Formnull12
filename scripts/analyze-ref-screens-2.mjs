// Retry rate-limited screenshots with delays
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const dir = '/home/z/my-project/upload/youform-screens/youform screenshot';
const outPath = '/home/z/my-project/scripts/vlm-results-2.md';

const files = [
  'shot_0031_20260903_185750_682.png',
  'shot_0032_20260903_185755_643.png',
  'shot_0033_20260903_185811_756.png',
  'shot_0034_20260903_185821_387.png',
  'shot_0035_20260903_190150_442.png',
  'shot_0036_20260903_190158_336.png',
  'shot_0037_20260903_190221_530.png',
  'shot_0038_20260903_190225_113.png',
  'shot_0039_20260903_190241_820.png',
  'shot_0040_20260903_190251_136.png',
];

const prompt = `You are analyzing a screenshot from the Youform form builder (a Typeform-like product). This is a REFERENCE for which field types exist and what settings each field type exposes.

Report EXACTLY in this format:
FIELD TYPE: <the field/block type being configured or shown>
SIDEBAR SETTINGS: <comma-separated list of EVERY setting name visible in the right sidebar/properties panel, include control type (toggle/text/select) and any visible values/options>
CANVAS PREVIEW: <one line describing how the field renders>
NOTES: <anything notable: validation options, special behaviors, layout options>

Be literal and exhaustive about setting names. If multiple field types are visible in the left panel/block list or an Add Block modal, list them too.`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const zai = await ZAI.create();
  const results = [];
  for (const f of files) {
    const imgPath = path.join(dir, f);
    const base64 = fs.readFileSync(imgPath).toString('base64');
    let done = false;
    for (let attempt = 1; attempt <= 4 && !done; attempt++) {
      try {
        const res = await zai.chat.completions.createVision({
          messages: [
            { role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
            ]}
          ],
          thinking: { type: 'disabled' }
        });
        const content = res.choices[0]?.message?.content || 'NO CONTENT';
        results.push(`### ${f}\n\n${content}\n`);
        console.log(`OK: ${f}`);
        done = true;
      } catch (e) {
        console.log(`ERR(${attempt}): ${f} -> ${e.message.slice(0, 100)}`);
        await sleep(30000 * attempt);
      }
    }
    if (!done) results.push(`### ${f}\n\nFAILED AFTER RETRIES\n`);
    fs.writeFileSync(outPath, `# VLM retry results\n\n${results.join('\n---\n\n')}`);
    await sleep(20000);
  }
  console.log('DONE');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
