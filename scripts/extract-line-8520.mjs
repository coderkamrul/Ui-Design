import fs from 'fs';
import readline from 'readline';

async function extractLine8520() {
  const fileStream = fs.createReadStream('C:/Users/h/.gemini/antigravity/brain/05eab66c-4a33-46de-82d6-52d18c2d2a36/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let curr = 0;
  for await (const line of rl) {
    curr++;
    if (curr === 8520) {
      const obj = JSON.parse(line);
      fs.writeFileSync('scripts/richmond_auto_raw.html', obj.content, 'utf8');
      console.log('Saved line 8520, length:', obj.content.length);
      break;
    }
  }
}
extractLine8520();
