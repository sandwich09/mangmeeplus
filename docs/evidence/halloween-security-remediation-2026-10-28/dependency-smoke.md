# Dependency compatibility smoke — 2026-10-28

Run from the repository root after installation:

```sh
node docs/evidence/halloween-security-remediation-2026-10-28/dependency-smoke.mjs
```

Requires the installed workspace packages, Node >=20.19 and Python3 standard library. The script creates temporary TAR, TAR.GZ, TAR.BZ2 and ZIP fixtures, resolves the actual SWC downloader dependencies, checks detection/extracted content, and compiles/runs a TypeScript export using the installed SWC CLI and API compiler settings. Temporary files are removed. Successful output is saved in `dependency-smoke.log`. This checks compatibility, not adversarial archive safety.

The initial attempt to force file-type21.3.2 into downloader15/archive-type7/decompress10 failed the TAR.GZ check: file-type returns `tar.gz`, while archive-type7 and decompress-targz8 recognize only `gz`. The final change updates the upstream SWC CLI to0.8.1 and uses its supported bin-wrapper14/downloader16/archive-type8/decompress11 chain, with file-type21.3.4. No local parser patch or forced file-type override remains.

Primary package sources (version metadata also verified through `pnpm view`):

- [SWC CLI maintained package](https://github.com/swc-project/pkgs/tree/main/packages/cli)
- [Archive detection implementation](https://github.com/XhmikosR/archive-type/blob/main/index.js)
- [Gzip extraction implementation](https://github.com/XhmikosR/decompress-targz/blob/main/index.js)
- [file-type implementation/API](https://github.com/sindresorhus/file-type)
- [Zod4.6.6 release and bounded-collection fix](https://github.com/colinhacks/zod/releases/tag/v4.6.6). Registry's latest3.x remains3.25.76; no patched3.x version was available. Installed4.6.7 is within the selected patched minor range.

## http-cache-semantics advisory caveat

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp) lists <=4.2.0 as affected and says no patched version. The [upstream maintainer disputes the report and closed it as not planned](https://github.com/kornelski/http-cache-semantics/issues/56), explaining that response sharing is controlled by `Cache-Control: private`, not by changing freshness. Registry4.3.0 points to the [official upstream release commit](https://github.com/kornelski/http-cache-semantics/commit/b1d4bd682fbab0252985de45219f4e7497c0067c). The final graph uses this maintained version, outside the advisory's reported range, and audits are clean. This is not evidence of a confirmed security-code fix, and no advisory suppression was added.
