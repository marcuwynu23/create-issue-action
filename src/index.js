const Core = require("@actions/core");
const Github = require("@actions/github");

const listToArray = (str) => str.split(",").map(s => s.trim()).filter(Boolean);
const asBool = (v, def = false) => (v == null || v === "" ? def : /^(true|1|yes)$/i.test(String(v).trim()));

(async () => {
  try {
    const rtrue = { required: true };
    const token = Core.getInput("token", rtrue);

    const repoContext = Github.context.repo;
    const owner = Core.getInput("owner") || repoContext.owner;
    const repo  = Core.getInput("repo")  || repoContext.repo;
    const title = Core.getInput("title", rtrue);

    // optional
    const body       = Core.getInput("body");
    const milestone  = Core.getInput("milestone");
    const labelsStr  = Core.getInput("labels");
    const assignees  = Core.getInput("assignees");

    // reuse options
    const reuse                = asBool(Core.getInput("reuse"), false);
    const reuseReopen          = asBool(Core.getInput("reuse_reopen"), true);
    const bumpWithComment      = asBool(Core.getInput("reuse_bump_with_comment"), true);
    const reuseMatchLabels     = asBool(Core.getInput("reuse_match_labels"), true); // default true
    const reuseCloseOthers     = asBool(Core.getInput("reuse_close_others"), false); // NEW: default false
    const closeOthersComment   = Core.getInput("reuse_close_others_comment") || "Closing as duplicate of canonical issue.";

    const octokit = Github.getOctokit(token);

    const parsedLabels = labelsStr ? listToArray(labelsStr) : null;
    const optsBase = Object.fromEntries(
      Object.entries({
        owner, repo, title,
        body: body === "" ? null : body,
        milestone: milestone === "" ? null : milestone,
        labels: parsedLabels,
        assignees: assignees ? listToArray(assignees) : null,
      }).filter(([, v]) => v != null)
    );

    async function fetchIssue(number) {
      const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
      return data;
    }

    // Find ONE by exact title (labels optional), with fallbacks.
    async function findIssueByTitle(state) {
      const per_page = 100;

      // Pass 1: with labels (AND semantics)
      if (labelsStr && labelsStr.trim() && reuseMatchLabels) {
        let page = 1;
        while (true) {
          const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state, per_page, page, labels: labelsStr });
          const found = data.find(i => !i.pull_request && i.title === title);
          if (found) return found;
          if (data.length < per_page) break;
          page++;
        }
      }

      // Pass 2: title-only
      {
        let page = 1;
        while (true) {
          const { data } = await octokit.rest.issues.listForRepo({ owner, repo, state, per_page, page });
          const found = data.find(i => !i.pull_request && i.title === title);
          if (found) return found;
          if (data.length < per_page) break;
          page++;
        }
      }

      // Pass 3: search fallback
      const q = `repo:${owner}/${repo} is:issue in:title "${title.replace(/"/g, '\\"')}" ${state === "open" ? "state:open" : state === "closed" ? "state:closed" : ""}`;
      try {
        const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 20 });
        const item = (data.items || []).find(i => !i.pull_request && i.title === title);
        if (item) return await fetchIssue(item.number);
      } catch (e) { /* noop */ }

      return null;
    }

    // Find ALL issues (open or closed) that match the same title (and labels if configured)
    async function findAllIssuesByTitle() {
      const per_page = 100;
      const results = [];

      async function collect(state, withLabels) {
        let page = 1;
        while (true) {
          const params = { owner, repo, state, per_page, page };
          if (withLabels && labelsStr && labelsStr.trim()) params.labels = labelsStr;
          const { data } = await octokit.rest.issues.listForRepo(params);
          results.push(...data.filter(i => !i.pull_request && i.title === title));
          if (data.length < per_page) break;
          page++;
        }
      }

      if (reuseMatchLabels && labelsStr && labelsStr.trim()) {
        await collect("open", true);
        await collect("closed", true);
      } else {
        await collect("open", false);
        await collect("closed", false);
      }
      // de-dup
      const map = new Map();
      for (const i of results) map.set(i.number, i);
      return Array.from(map.values());
    }

    let canonical = null;
    let reopened = false;

    if (reuse) {
      canonical = await findIssueByTitle("open");
      if (!canonical) {
        const closed = await findIssueByTitle("closed");
        if (closed && reuseReopen) {
          await octokit.rest.issues.update({ owner, repo, issue_number: closed.number, state: "open" });
          canonical = await fetchIssue(closed.number);
          reopened = true;
        } else if (closed) {
          canonical = closed; // keep closed if not reopening
        }
      }

      if (canonical) {
        if (body && body.trim()) {
          const { data: updated } = await octokit.rest.issues.update({
            owner, repo, issue_number: canonical.number, body
          });
          canonical = updated;
        }
        if (bumpWithComment) {
          await octokit.rest.issues.createComment({
            owner, repo, issue_number: canonical.number,
            body: `🔄 ${reopened ? "Reopened" : "Updated"} on ${new Date().toISOString()}`
          });
        }
      }
    }

    // If no canonical yet, create a new one
    if (!canonical) {
      const { data } = await octokit.rest.issues.create(optsBase);
      canonical = data;
    }

    // Optionally close all other duplicates
    if (reuseCloseOthers) {
      const all = await findAllIssuesByTitle();
      for (const i of all) {
        if (i.number === canonical.number) continue;
        if (i.state !== "closed") {
          // add comment linking to canonical before closing
          await octokit.rest.issues.createComment({
            owner, repo, issue_number: i.number,
            body: `${closeOthersComment}\n\nCanonical: #${canonical.number} (${canonical.html_url})`
          });
          await octokit.rest.issues.update({ owner, repo, issue_number: i.number, state: "closed" });
        }
      }
    }

    // Outputs point to canonical
    Core.setOutput("json", JSON.stringify(canonical));
    Core.setOutput("number", canonical.number);
    Core.setOutput("html_url", canonical.html_url);
    Core.info(`Canonical issue: #${canonical.number} → ${canonical.html_url}`);

  } catch (err) {
    Core.error(err);
    Core.setFailed("Request to create/reuse/close issues failed");
  }
})();
