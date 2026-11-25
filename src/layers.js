// The layers panel's grouping and moves: the layers of one part (its colour layers, its pieces)
// are listed together under the part's name, and move as one block.

/**
 * Groups the layers of an image by item, top-most first: [{item, draws}], in the order of each
 * item's top-most layer. itemOf gives the item of a draw's item key (a piece belongs to its item).
 */
export function groupLayers(draws, itemOf) {
  const groups = [];
  const byItem = new Map();
  for (const draw of draws) {
    const item = itemOf(draw.item);
    let group = byItem.get(item);
    if (!group) {
      group = { item, draws: [] };
      byItem.set(item, group);
      groups.push(group);
    }
    group.draws.push(draw);
  }
  return groups;
}

/**
 * The ids of a group's top block: its top-most layer and the group's layers right under it. A part
 * whose layers sit apart (a cloak's front and back) moves only that block, so the back stays back.
 */
export function topRun(order, groupIds) {
  const ids = new Set(groupIds);
  const start = order.findIndex((id) => ids.has(id));
  if (start < 0) return [];
  let end = start;
  while (end + 1 < order.length && ids.has(order[end + 1])) end++;
  return order.slice(start, end + 1);
}

/** Moves a block of ids (kept in its order) right above or below (below = true) target. */
export function moveBlock(order, block, target, below) {
  if (block.includes(target)) return order;
  const rest = order.filter((id) => !block.includes(id));
  const at = rest.indexOf(target);
  if (at < 0) return order;
  rest.splice(at + (below ? 1 : 0), 0, ...block);
  return rest;
}

/**
 * Moves a block one step up (+1, towards the top) or down (-1), past the next layer that shows
 * (shown(id)); layers with nothing drawn are passed over. order is top-most first.
 */
export function stepBlock(order, block, step, shown = () => true) {
  const inBlock = new Set(block);
  const ends = block.map((id) => order.indexOf(id));
  let i = step > 0 ? Math.min(...ends) - 1 : Math.max(...ends) + 1;
  while (i >= 0 && i < order.length && (inBlock.has(order[i]) || !shown(order[i]))) i += step > 0 ? -1 : 1;
  if (i < 0 || i >= order.length) return order;
  return moveBlock(order, block, order[i], step < 0);
}
