import { describe, expect, it } from 'vitest';
import { MENUS, visibleMenu } from './menus';

describe('visibleMenu', () => {
  it('hides items the user lacks permission for', () => {
    const items = visibleMenu(MENUS.group, (p) => !p);
    expect(items.map((i) => i.title)).toEqual(['Dashboard']);
  });

  it('shows everything for wildcard permissions', () => {
    expect(visibleMenu(MENUS.group, () => true)).toHaveLength(MENUS.group.length);
  });
});
