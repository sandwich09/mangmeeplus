import base from './playwright.manual.config';
export default {...base,use:{...base.use,browserName:'webkit'},reporter:[['list'],['json',{outputFile:'/tmp/manual-flag-e2e-20261001/evidence/webkit-results.json'}]],outputDir:'/tmp/manual-flag-e2e-20261001/evidence/webkit-tests'};
