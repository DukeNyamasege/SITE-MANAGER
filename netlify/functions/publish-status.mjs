import { HttpError, TARGET_BRANCH, errorResponse, github, json, requireAuth } from './_lib.mjs';

export const handler = async event => {
  try {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const authorizedSiteId = requireAuth(event);

    const prNumber = Number(event.queryStringParameters?.pr);
    if (!Number.isInteger(prNumber) || prNumber <= 0) throw new HttpError(400, 'A valid pull request number is required.');

    const pr = await github(`pulls/${prNumber}`);
    const expectedPrefix = `bot-manager/${authorizedSiteId}-`;
    if (pr?.base?.ref !== TARGET_BRANCH || !String(pr?.head?.ref || '').startsWith(expectedPrefix)) {
      throw new HttpError(403, 'This session can only inspect and merge publishes for its authenticated domain.');
    }

    if (pr.merged) {
      return json(200, {
        status: 'merged',
        message: `PR #${prNumber} is merged. Netlify can now deploy the target main branch.`,
        merge_sha: pr.merge_commit_sha,
      });
    }

    if (pr.state !== 'open') {
      return json(200, { status: 'failed', message: `PR #${prNumber} is closed without being merged.` });
    }

    const headSha = pr?.head?.sha;
    if (!headSha) throw new HttpError(500, 'The validation pull request has no head SHA.');

    const runs = await github(`actions/runs?head_sha=${encodeURIComponent(headSha)}&event=pull_request&per_page=30`);
    const workflow = Array.isArray(runs?.workflow_runs)
      ? runs.workflow_runs.find(run => run.name === 'Node.js compatibility')
      : null;

    if (!workflow) {
      return json(200, {
        status: 'pending',
        message: `PR #${prNumber} created. Waiting for the Node.js compatibility workflow to start…`,
      });
    }

    if (workflow.status !== 'completed') {
      return json(200, {
        status: 'pending',
        message: `PR #${prNumber}: Node 22/24 validation is ${workflow.status}.`,
        workflow_url: workflow.html_url,
      });
    }

    if (workflow.conclusion !== 'success') {
      return json(200, {
        status: 'failed',
        message: `PR #${prNumber} was not merged because validation finished with: ${workflow.conclusion}.`,
        workflow_url: workflow.html_url,
      });
    }

    if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
      return json(200, {
        status: 'failed',
        message: `PR #${prNumber} passed validation but now conflicts with main. Reload the domain and publish again.`,
        workflow_url: workflow.html_url,
      });
    }

    let merge;
    try {
      merge = await github(`pulls/${prNumber}/merge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sha: headSha,
          merge_method: 'merge',
          commit_title: `Publish managed bots (PR #${prNumber})`,
        }),
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 405 || error.status === 409)) {
        return json(200, {
          status: 'failed',
          message: `PR #${prNumber} passed validation but GitHub could not merge it. Reload the domain and publish again.`,
          workflow_url: workflow.html_url,
        });
      }
      throw error;
    }

    if (!merge?.merged) {
      return json(200, { status: 'failed', message: merge?.message || `GitHub did not merge PR #${prNumber}.` });
    }

    try {
      await github(`git/refs/heads/${pr.head.ref}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Published successfully but could not delete temporary branch:', error);
    }

    return json(200, {
      status: 'merged',
      message: `Published successfully. PR #${prNumber} passed Node 22/24 checks and was merged to ${TARGET_BRANCH}.`,
      merge_sha: merge.sha,
      workflow_url: workflow.html_url,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
