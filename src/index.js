const Core = require("@actions/core");
const Github = require("@actions/github");

const listToArray = (str) =>
  str
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const asBool = (v, def = false) =>
  v == null || v === "" ? def : /^(true|1|yes)$/i.test(String(v).trim());

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

    // matching/cleanup options
    // If true, only consider issues that also have *all* the labels in labelsStr.
    // If false, match purely by title regardless of labels.
    const matchLabels = asBool(Core.getInput("match_labels"), true);
    const closeComment =
      Core.getInput("close_comment") ||
      "Closing in favor of the newly created canonical issue.";

    const octokit = Github.getOctokit(token);

    const parsedLabels = labelsStr ? listToArray(labelsStr) : null;

    const creationOpts = Object.fromEntries(
      Object.entries({
        owner,
        repo,
        title,
        body: body === "" ? null : body,
        milestone: milestone === "" ? null : milestone,
        labels: parsedLabels,
        assignees: assignees ? listToArray(assignees) : null,
      }).filter(([, v]) => v != null)
    );

    Core.debug(`owner=${owner} repo=${repo}`);
    Core.debug(`title=${title}`);
    Core.debug(`labelsStr=${labelsStr}`);
    Core.debug(`matchLabels=${matchLabels}`);

    // Find ALL OPEN issues with the same title (optionally requiring the same labels)
    async function findOpenIssuesByTitle() {
      const per_page = 100;
      const results = [];

      let page = 1;
      while (true) {
        const params = {owner, repo, state: "open", per_page, page};
        if (matchLabels && labelsStr && labelsStr.trim()) {
          params.labels = labelsStr; // AND semantics
        }

        const {data} = await octokit.rest.issues.listForRepo(params);
        // Exclude PRs; exact title match
        const matches = data.filter(
          (i) => !i.pull_request && i.title === title
        );
        results.push(...matches);

        Core.debug(
          `[findOpenIssuesByTitle] page=${page} found=${matches.length}`
        );
        if (data.length < per_page) break;
        page++;
      }

      // If we matched by labels and found nothing, fall back to title-only
      if (results.length === 0 && matchLabels) {
        Core.debug(
          "[findOpenIssuesByTitle] No matches with labels; falling back to title-only."
        );
        let page2 = 1;
        while (true) {
          const {data} = await octokit.rest.issues.listForRepo({
            owner,
            repo,
            state: "open",
            per_page,
            page: page2,
          });
          const matches2 = data.filter(
            (i) => !i.pull_request && i.title === title
          );
          results.push(...matches2);
          Core.debug(
            `[findOpenIssuesByTitle:fallback] page=${page2} found=${matches2.length}`
          );
          if (data.length < per_page) break;
          page2++;
        }
      }

      // Deduplicate by issue number just in case
      const map = new Map();
      for (const i of results) map.set(i.number, i);
      return Array.from(map.values());
    }

    // 1) Find all open duplicates (by exact title)
    const openDuplicates = await findOpenIssuesByTitle();
    Core.info(
      `Found ${openDuplicates.length} open issue(s) with the same title.`
    );

    // 2) Create the new canonical issue first (so we can link to it when closing others)
    const {data: newIssue} = await octokit.rest.issues.create(creationOpts);
    Core.info(
      `Created new canonical issue: #${newIssue.number} (${newIssue.html_url})`
    );

    // 3) Close all other open issues with the same title
    for (const issue of openDuplicates) {
      if (issue.number === newIssue.number) continue; // shouldn't happen, but guard anyway
      try {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issue.number,
          body: `${closeComment}\n\nCanonical: #${newIssue.number} (${newIssue.html_url})`,
        });
        await octokit.rest.issues.update({
          owner,
          repo,
          issue_number: issue.number,
          state: "closed",
        });
        Core.info(`Closed duplicate issue #${issue.number}`);
      } catch (e) {
        Core.warning(`Failed to close issue #${issue.number}: ${e.message}`);
      }
    }

    // 4) Outputs → the newly created canonical issue
    Core.setOutput("json", JSON.stringify(newIssue));
    Core.setOutput("number", newIssue.number);
    Core.setOutput("html_url", newIssue.html_url);
  } catch (err) {
    Core.error(err);
    Core.setFailed("Failed to close existing issues and create a new one");
  }
})();
