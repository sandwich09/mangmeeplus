import base from './playwright.extended.config';
export default {...base,use:{...base.use,actionTimeout:15000},reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/recheck-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/recheck-tests'};
