export function reorderedMenuIds(items, itemId, direction) {
  const item = items.find((entry) => entry.id === itemId);
  if (!item) return null;
  const categoryItems = items.filter((entry) => entry.category === item.category);
  const index = categoryItems.findIndex((entry) => entry.id === itemId);
  const target = categoryItems[index + (direction === "up" ? -1 : 1)];
  if (!target) return null;
  const ids = items.map((entry) => entry.id);
  const currentIndex = ids.indexOf(itemId);
  const targetIndex = ids.indexOf(target.id);
  [ids[currentIndex], ids[targetIndex]] = [ids[targetIndex], ids[currentIndex]];
  return ids;
}
