# dacbd/create-issue-action@main

The #1 simple and awesome create-issue action on GitHub. 🌟

Basically a converter that takes your yaml entry and connects it to the rest endpoint to create an issue on GitHub.

## Quick Start (or [jump to advanced](#generate-advanced-report)):

```yml
steps:
  - uses: actions/checkout@v4
  - name: create an issue
    uses: dacbd/create-issue-action@main
    with:
      token: ${{ github.token }}
      title: Simple test issue
      body: my new issue
```

---

## ✨ New: Reuse an existing issue (avoid duplicates)

Set `reuse: "true"` to **reuse an existing issue** with the same `title` (and, if provided, matching `labels`), instead of creating a new one.  
When reusing, the action can **update the body**, **reopen** a closed match, and optionally **add a small comment** to bump the issue to the top.

```yml
steps:
  - uses: actions/checkout@v4

  - name: Create or reuse issue
    uses: dacbd/create-issue-action@main
    with:
      token: ${{ github.token }}
      title: "🚀 Pending Production Merge for User Frontend"
      body: |
        A successful deployment was made to STAGING from the `develop` branch for the **User Frontend**.

        - ✅ Commit: `${{ github.sha }}`
        - 👤 Triggered by: `${{ github.actor }}`
        - 📅 Time: `${{ github.event.head_commit.timestamp || github.run_id }}`

        _This issue was automatically updated after successful deployment._
      labels: "deployment,review,production"

      # 🔽 new options
      reuse: "true"                   # try to reuse instead of creating a duplicate
      reuse_reopen: "true"            # if the match is closed, reopen it (default: true)
      reuse_bump_with_comment: "true" # add a short comment so it shows at the top (default: true)
```

**Matching rules:**
- The action first looks for an **open** issue with the **same title** (and **labels** if you passed them).
- If none is open, it looks for a **closed** match and **reopens** it when `reuse_reopen: "true"`.
- If no match is found, it **creates a new issue** (original behavior).
- When reusing, if `body` is provided, the issue **body is replaced** with the new content.
- When `reuse_bump_with_comment: "true"`, the action posts a small comment to **bump activity/order**.

> Outputs (`json`, `number`, `html_url`) always point to the **issue actually used** (reused or newly created).

---

## Configure

### Inputs (through `with:`)

| Option  | Default Value  | Notes  |
| ------------ | ------------ | ------------ |
| token      | github.token / `required`  | Use `${{ github.token }}` (same as `${{secrets.GITHUB_TOKEN}}`) or a PAT stored in secrets.   |
| owner      | github.context.repo.owner  | Owner of the target repo. Implied from context.  |
| repo       | github.context.repo.repo   | Repo name. Implied from context.  |
| title      | `required`                 |   |
| body       |                            | If set during reuse, replaces the existing issue body.  |
| milestone  |                            |   |
| labels     |                            | Comma-separated labels. Also used during reuse matching. |
| assignees  |                            | Comma-separated GitHub usernames. |

### ➕ New reuse options

| Option  | Default Value  | Notes  |
| ------------ | ------------ | ------------ |
| reuse | `"false"` | If `"true"`, reuse an existing issue with the same `title` (and `labels` if provided) before creating a new one. |
| reuse_reopen | `"true"` | If a matching issue is **closed**, reopen it and then update. |
| reuse_bump_with_comment | `"true"` | When reusing, add a short comment (e.g., “Updated on …”) to bump activity/order. |

### Outputs

| output | value |
| ------ | ----- |
| json | [See Response](https://docs.github.com/en/rest/issues/issues#create-an-issue) (created **or** reused issue) |
| html_url | the issue’s web url |
| number | the issue’s number |

---

## Usage Examples

### Reuse for deployment notifications (no duplicates)

```yml
- name: Create or reuse “Pending Production Merge” issue
  uses: dacbd/create-issue-action@main
  with:
    token: ${{ github.token }}
    title: "🚀 Pending Production Merge for User Frontend"
    labels: "deployment,review,production"
    body: |
      Deployment to STAGING succeeded.
      - Commit: `${{ github.sha }}`
      - Actor: `${{ github.actor }}`
      - Time: `${{ github.run_started_at }}`

    reuse: "true"
    reuse_reopen: "true"
    reuse_bump_with_comment: "true"
```

### Append-only (keep history in comments)

If you prefer not to replace the body on updates, omit `body` and rely on the bump comment to log the event:

```yml
- name: Reuse issue and only bump with a comment
  uses: dacbd/create-issue-action@main
  with:
    token: ${{ github.token }}
    title: "Nightly Report"
    labels: "report,nightly"
    reuse: "true"
    reuse_bump_with_comment: "true"
    # no body — existing body stays intact; a comment will be added to bump/order
```

---

## Issues & debugging

If you encounter issues with `dacbd/create-issue-action@main`, feel free to create an issue or a PR—happy to take improvements or requests.

> [!TIP]
> - Issue shortcut: https://github.com/dacbd/create-issue-action/issues/new  
> - Enable step debug logging: [`ACTIONS_STEP_DEBUG`](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging#enabling-step-debug-logging)

## Contributors

<a href="https://github.com/dacbd/create-issue-action/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dacbd/create-issue-action" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

## Community Activities

Proposed to auto-generate repo activity report via https://repobeats.axiom.co/
