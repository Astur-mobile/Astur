import { test, flattenTree } from '@astur-mobile/test';

test('probe flutter semantic tree (ios)', async ({ device }) => {
  await device.app.launch().catch(() => undefined);

  for (const waitMs of [3000, 6000, 10000]) {
    await new Promise((r) => setTimeout(r, waitMs));
    const tree = await device.tree().catch((e) => {
      console.log(`PROBE tree() error after ${waitMs}ms:`, (e as Error).message);
      return undefined;
    });
    if (!tree) continue;
    const nodes = flattenTree(tree);
    console.log(`\nPROBE @${waitMs}ms — node count: ${nodes.length}`);
    const interesting = nodes.filter((n) => n.id || n.text || n.label || n.value);
    console.log(`PROBE interesting (id/text/label/value) count: ${interesting.length}`);
    for (const n of interesting.slice(0, 60)) {
      console.log(
        'PROBE_NODE ' +
          JSON.stringify({
            id: n.id,
            role: (n as any).role,
            text: n.text,
            label: n.label,
            value: n.value,
            visible: n.visible
          })
      );
    }
  }
});
