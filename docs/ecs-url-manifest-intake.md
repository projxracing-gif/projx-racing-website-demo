# ECS product URL manifest intake

This offline utility prepares a future ECS-supplied or otherwise explicitly authorized list of public product URLs for controlled catalogue review. It does not visit, crawl, download or enrich any URL and does not modify the storefront or database.

## Input and output

The input is a UTF-8 text file with one ECS product URL per line. Blank lines, lines beginning with `#`, and a first `url`, `source_url` or `product_url` header are ignored. Every other line must be a public HTTPS ECS product URL using the normal `/b-...-parts/.../.../` path.

Run:

```text
npm run catalog:ecs:url-manifests -- \
  --input C:\authorized-supplier-data\ecs-product-urls.txt \
  --output private-imports\ecs-url-manifests\2026-08-05
```

The output directory must not already exist. Inside this repository, output is restricted to a descendant of the Git-ignored `private-imports/` directory. A new directory outside the repository is also accepted. Supplier inputs and generated manifests must not be committed.

## Processing guarantees

- The input is read as a stream and is never loaded as one large array.
- URLs are validated and canonicalized to `https://www.ecstuning.com/` without query strings or fragments.
- Invalid lines fail the entire run; partial manifests are removed.
- Canonical URLs are hash-partitioned, deduplicated with bounded memory, and written to bounded JSON manifests.
- The default limit is 10,000 URLs and 2 MiB per manifest. Use `--max-urls`, `--max-bytes` or `--buckets` only when an import design requires different bounds.
- Output is published by a final directory rename and existing output is never replaced.

Each manifest uses the existing offline ingestion shape, with canonical URL strings under `entries`. `index.json` records source counts, duplicate counts, limits, source SHA-256, each manifest SHA-256 and a checksum for the ordered manifest set. `index.json.sha256` contains the checksum of the exact index file.

This step is intake preparation only. It does not prove permission to automate ECS access, does not supply product data, and does not approve any item for publication. Product fields, images, prices, availability and fitment still require an authorized structured source and the existing human review workflow.

## Test

```text
npm run test:ecs-catalog
```

The tests use local temporary files only and perform no network requests.
