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
    Core.debug(`Using token: ${token}`);

    const repoContext = Github.context.repo;
    const owner = Core.getInput("owner") || repoContext.owner;
    const repo = Core.getInput("repo") || repoContext.repo;
    const title = Core.getInput("title", rtrue);
    Core.debug(`Using owner: ${owner}`);
    Core.debug(`Using repo: ${repo}`);
    Core.debug(`Using title: ${title}`);

    // optional
    const body = Core.getInput("body");
    const milestone = Core.getInput("milestone");
    const labelsStr = Core.getInput("labels");
    const assignees = Core.getInput("assignees");

    // new optional (reuse feature)
    const reuse = asBool(Core.getInput("reuse"), false);
    const reuseReopen = asBool(Core.getInput("reuse_reopen"), true);
    const bumpWithComment = asBool(
      Core.getInput("reuse_bump_with_comment"),
      true
    );

    Core.debug(`Using body: """${body}"""`);
    Core.debug(`Using milestone: ${milestone}`);
    Core.debug(`Using labels: ${labelsStr}`);
    Core.debug(`Using assignees: ${assignees}`);
    Core.debug(
      `Reuse: ${reuse}, Reopen: ${reuseReopen}, BumpWithComment: ${bumpWithComment}`
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

    // Helper to find an issue by title (+ optional labels) with pagination
    async function findIssueByTitleAndLabels(state) {
      const per_page = 100;
      let page = 1;
      while (true) {
        const params = {owner, repo, state, per_page, page};
        // If labels were provided, filter by labels server-side for fewer results
        if (labelsStr && labelsStr.trim()) params.labels = labelsStr;

        const {data} = await octokit.rest.issues.listForRepo(params);
        // Exclude PRs and match exact title
        const found = data.find((i) => !i.pull_request && i.title === title);
        if (found) return found;
        if (data.length < per_page) break;
        page++;
      }
      return null;
    }

    if (reuse) {
      // 1) Try open issue
      let issue = await findIssueByTitleAndLabels("open");

      // 2) If not found, try closed and reopen if allowed
      let reopened = false;
      if (!issue) {
        const closed = await findIssueByTitleAndLabels("closed");
        if (closed && reuseReopen) {
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: closed.number,
            state: "open",
          });
          issue = closed;
          reopened = true;
          Core.info(`Reopened existing issue #${issue.number}`);
        } else if (closed) {
          // If reuseReopen is false and a closed one exists, we’ll just reuse its number/URL without reopening
          issue = closed;
          Core.info(
            `Found closed issue #${issue.number} (not reopened due to reuse_reopen=false)`
          );
        }
      }

      if (issue) {
        // Update body if provided
        if (body && body.trim()) {
          await octokit.rest.issues.update({
            owner,
            repo,
            issue_number: issue.number,
            body,
          });
          Core.info(`Updated issue body for #${issue.number}`);
        }

        // Add a small comment to bump activity/ordering if configured
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

        // Outputs point to the reused issue
        Core.setOutput("json", JSON.stringify(issue));
        Core.setOutput("number", issue.number);
        Core.setOutput("html_url", issue.html_url);
        Core.info(`Reused: ${issue.html_url}`);
        return;
      }
      // If we reach here, no matching issue exists → fall through to create new
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
