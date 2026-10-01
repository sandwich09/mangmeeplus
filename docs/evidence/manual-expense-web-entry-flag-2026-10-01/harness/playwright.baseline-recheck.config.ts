import base from './playwright.on-regression.config';
export default {...base,reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/baseline-recheck-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/baseline-recheck-tests'};
