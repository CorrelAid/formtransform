// Reads {"survey": [...], "choices": {...}} on stdin and prints the DDI XML
// that formtransform's buildDdiXml produces, using the built dist/.
import { buildDdiXml } from '../../../dist/index.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { survey, choices } = JSON.parse(input);
process.stdout.write(buildDdiXml(survey, choices));
