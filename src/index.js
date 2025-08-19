const Core = require("@actions/core");
const Github = require("@actions/github");

const listToArray = (str) => {
  const arr = str.split(",");
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i].trim();
  return arr;
};

const asBool = (v, def = false) => {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  return /^(true|1|yes)$/i.test(String(v).trim());
};

(async () => {
  try {
    const rtrue = {required: true};
    const token = Core.getInput("token", rtrue);

    const repoContext = Github.context.repo;
    const owner = Core.getInput("owner") || repoContext.owner;
    const repo = Core.getInput("repo") || repoContext.repo;
    const title = Core.getInput("title", rtrue);

    // optional
    const body = Core.getInput("body");
    const milestone = Core.getInput("milestone");
    const labelsStr = Core.getInput("labels");
    const assignees = Core.getInput("assignees");

    // reuse options
    const reuse = asBool(Core.getInput("reuse"), false);
    const reuseReopen = asBool(Core.getInput("reuse_reopen"), true);
    const bumpWithComment = asBool(
      Core.getInput("reuse_bump_with_comment"),
      true
    );
    const reuseMatchLabels = asBool(Core.getInput("reuse_match_labels"), true); // new, default true

    Core.debug(`owner=${owner} repo=${repo}`);
    Core.debug(`title=${title}`);
    Core.debug(`labelsStr=${labelsStr}`);
    Core.debug(
      `reuse=${reuse} reuseReopen=${reuseReopen} bumpWithComment=${bumpWithComment} reuseMatchLabels=${reuseMatchLabels}`
    );

    const octokit = Github.getOctokit(token);

    // Build base options for creation/update
    const parsedLabels = labelsStr ? listToArray(labelsStr) : null;
    const optsBase = Object.fromEntries(
      Object.entries({
        owner,
        repo,
        title,
        body: body === "" ? null : body,
        milestone: milestone === "" ? null : milestone,
        labels: parsedLabels,
        assignees: assignees ? listToArray(assignees) : null,
      }).filter(([_, v]) => v != null)
    );

    async function fetchIssue(number) {
      const {data} = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: number,
      });
      return data;
    }

    // Helper to find an issue by exact title.
    // Strategy:
    //  1) listForRepo with labels (if provided & reuseMatchLabels)
    //  2) listForRepo without labels (title-only)
    //  3) search API (exact title; robust fallback)
    async function findIssueByTitle(state) {
      const per_page = 100;

      // Pass 1: with labels (AND semantics). Only if labels provided & enabled.
      if (labelsStr && labelsStr.trim() && reuseMatchLabels) {
        let page = 1;
        while (true) {
          const {data} = await octokit.rest.issues.listForRepo({
            owner,
            repo,
            state,
            per_page,
            page,
            labels: labelsStr,
          });
          const found = data.find((i) => !i.pull_request && i.title === title);
          Core.debug(
            `[findIssueByTitle] pass=labels state=${state} page=${page} found=${!!found}`
          );
          if (found) return found;
          if (data.length < per_page) break;
          page++;
        }
      }

      // Pass 2: title-only
      {
        let page = 1;
        while (true) {
          const {data} = await octokit.rest.issues.listForRepo({
            owner,
            repo,
            state,
            per_page,
            page,
          });
          const found = data.find((i) => !i.pull_request && i.title === title);
          Core.debug(
            `[findIssueByTitle] pass=title-only state=${state} page=${page} found=${!!found}`
          );
          if (found) return found;
          if (data.length < per_page) break;
          page++;
        }
      }

      // Pass 3: Search API (exact title)
      const q = `repo:${owner}/${repo} is:issue in:title "${title.replace(
        /"/g,
        '\\"'
      )}" ${
        state === "open"
          ? "state:open"
          : state === "closed"
          ? "state:closed"
          : ""
      }`;
      try {
        const {data} = await octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: 20,
        });
        const item = (data.items || []).find(
          (i) => !i.pull_request && i.title === title
        );
        Core.debug(
          `[findIssueByTitle] pass=search state=${state} found=${!!item}`
        );
        if (item) {
          // normalize via a get call to have full shape (labels, html_url, etc.)
          return await fetchIssue(item.number);
        }
      } catch (e) {
        Core.debug(`[findIssueByTitle] search error: ${e.message}`);
      }
      return null;
    }

    if (reuse) {
      // 1) Try OPEN
      let issue = await findIssueByTitle("open");

      // 2) Else CLOSED (potentially reopen)
      let reopened = false;
      if (!issue) {
        const closed = await findIssueByTitle("closed");
        if (closed && reuseReopen) {
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: closed.number,
            state: "open",
          });
          issue = await fetchIssue(closed.number);
          reopened = true;
          Core.info(`Reopened existing issue #${issue.number}`);
        } else if (closed) {
          issue = closed; // keep closed but still update/comment if desired
          Core.info(
            `Found closed issue #${issue.number} (not reopened due to reuse_reopen=false)`
          );
        }
      }

      if (issue) {
        // Update body if provided
        if (body && body.trim()) {
          const {data: updated} = await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            body,
          });
          issue = updated;
          Core.info(`Updated issue body for #${issue.number}`);
        }

        // Bump with comment
        if (bumpWithComment) {
          const ts = new Date().toISOString();
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: issue.number,
            body: `🔄 ${reopened ? "Reopened" : "Updated"} on ${ts}`,
          });
          Core.info(`Added bump comment to issue #${issue.number}`);
        }

        // Outputs point to the reused issue (fresh copy)
        Core.setOutput("json", JSON.stringify(issue));
        Core.setOutput("number", issue.number);
        Core.setOutput("html_url", issue.html_url);
        Core.info(`Reused: ${issue.html_url}`);
        return;
      }

      Core.info("No existing issue found to reuse; creating a new one…");
    }

    // Create new issue (default behavior)
    Core.debug(
      `Object for new issue: """${JSON.stringify(optsBase, null, 2)}"""`
    );
    const newIssue = await octokit.rest.issues.create(optsBase);
    Core.info(`Created: ${newIssue.data.html_url}`);
    Core.setOutput("json", JSON.stringify(newIssue.data));
    Core.setOutput("number", newIssue.data.number);
    Core.setOutput("html_url", newIssue.data.html_url);
  } catch (err) {
    Core.error(err);
    Core.setFailed("Request to create new issue failed");
  }
})();
