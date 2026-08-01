---
title: "Long translation fixture"
tags:
  - "translation"
---
# Overview

This document explains a deliberately long workflow. It contains enough prose to require multiple translation chunks while retaining exact Markdown boundaries. Every paragraph describes a separate product concern and should remain in its original order.

## Scope

The first part defines who uses the product, which documents are included, and which outcomes are measurable. The translation process must not split a Unicode code point or silently discard a sentence when the provider reaches an output limit.

| Area | Requirement |
| --- | --- |
| Documents | Preserve Markdown structure |
| History | Resume from completed chunks |
| Models | Never switch automatically |

## Example

```rust
fn translate_document(source: &str) -> String {
    source.to_owned()
}
```

The final section covers retry behavior. A truncated response is subdivided at a safe boundary and retried with the same selected model. If three subdivisions still fail, the first incomplete chunk remains available as the resume point.

## Acceptance

- Progress reports the current chunk and total chunk count.
- Cancellation does not start another provider request.
- Completed chunks remain persisted without storing the full source text.
- Review applies each document only when its source revision still matches.
