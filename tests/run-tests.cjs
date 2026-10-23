'use strict';
const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.join(__dirname, 'output');
const suites = [
  { name: 'Lecteur, sécurité et exports', script: 'test-folio.cjs', report: 'rapport-dom.json' },
  { name: 'Stockage local', script: 'test-storage-dom.cjs', report: 'rapport-stockage.json' },
  { name: 'Module de suivi', script: 'test-watcher-module.cjs', report: 'rapport-watcher-module.json' },
  { name: 'Interface du suivi', script: 'test-watcher-dom.cjs', report: 'rapport-watcher-dom.json' },
  { name: 'Régressions de rendu et sécurité', script: 'test-security-regressions.cjs', report: 'rapport-security-regressions.json' },
  { name: 'Régressions de stockage', script: 'test-state-regressions.cjs', report: 'rapport-state-regressions.json' },
  { name: 'Régressions fonctionnelles et accessibilité', script: 'test-functional-regressions.cjs', report: 'functional-report.json' },
  { name: 'Collage Markdown', script: 'test-paste-regressions.cjs', report: 'rapport-paste-regressions.json' },
  { name: 'Diagrammes Mermaid', script: 'test-mermaid.cjs', report: 'rapport-mermaid.json' }
];

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  let failed = false;
  let passed = 0;
  let total = 0;

  for (const suite of suites) {
    const reportPath = path.join(outputDir, suite.report);
    fs.rmSync(reportPath, { force: true });
    let runtimeError;
    try { await require(path.join(__dirname, suite.script)); } catch (error) { runtimeError = error; }
    let report;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (_) {}
    const tests = Array.isArray(report?.tests) ? report.tests : [];
    const suitePassed = tests.filter(test => test.status === 'PASS').length;
    const successful = !runtimeError && process.exitCode === 0 && tests.length > 0 && suitePassed === tests.length;
    total += tests.length;
    passed += suitePassed;
    console.log(`${successful ? 'PASS' : 'FAIL'} — ${suite.name} : ${suitePassed}/${tests.length}`);
    if (!successful) {
      failed = true;
      if (runtimeError) console.error(runtimeError.stack || runtimeError.message);
      for (const test of tests.filter(test => test.status !== 'PASS')) {
        console.error(`${test.name}\n${test.message || 'Échec sans détail.'}`);
      }
      if (!report) console.error('Aucun rapport produit ; consulter l’erreur ci-dessus.');
    }
  }

  console.log(`\n${passed}/${total} scénarios réussis. Rapports : tests/output/`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
