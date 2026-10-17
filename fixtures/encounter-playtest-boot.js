// Injected only by `dev-server --encounter-playtest`. Never loaded by index.html.
{
  const rolls = [2, 4, 1, 2];
  let index = 0;
  Math.random = () => ((rolls[index++] ?? 1) - 1) / 6;
  const panel = document.createElement("aside");
  panel.id = "encounter-playtest";
  panel.style.cssText = "padding:12px;background:#162337;color:white;font:14px system-ui;position:relative;z-index:10";
  const instructions = document.createElement("p");
  instructions.textContent = "DEVELOPMENT FIXTURE: Roll (2,4), select Die 1, Right (cost 3; one hit), Left (cost 1; attack suppressed), Roll early (1,2; final roll). Try Roll again (blocked while time remains), then Right (cost 3; one new hit), then Roll (out-of-rolls death). Refresh to restart. This origin uses normal checkpoint storage; do not resume this fixture on production.";
  const show = document.createElement("button");
  show.textContent = "Refresh diagnostic trace";
  const output = document.createElement("pre");
  output.style.cssText = "max-height:260px;overflow:auto;white-space:pre-wrap";
  show.onclick = () => { output.textContent = JSON.stringify(window.getRunnerEventTrace?.() ?? "Open with ?runnerTrace=1 on localhost", null, 2); };
  panel.append(instructions, show, output);
  document.body.prepend(panel);
}
