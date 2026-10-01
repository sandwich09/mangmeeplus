import base from './playwright.manual.config';
export default {...base,testMatch:'manual-flag-extended.spec.ts',reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/extended-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/extended-tests'};
