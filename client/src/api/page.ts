// One page of a list, newest first. `page` starts at 1; `total` counts every item, not just this page.
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
