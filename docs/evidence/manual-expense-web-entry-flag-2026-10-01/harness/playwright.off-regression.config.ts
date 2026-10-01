import base from './playwright.manual.config';
export default {...base,testMatch:/(reimbursements|receipt-draft-continuity)\.spec\.ts/,reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/off-regression-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/off-regression-tests'};
