import base from './playwright.manual.config';
export default {...base,testMatch:/(expenses|expense-number-save|substitute-editable-navigation|substitute-cancelled-view-only)\.spec\.ts/,reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/on-regression-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/on-regression-tests'};
