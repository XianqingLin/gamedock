import type { Category, Topic } from '../lib/types';

interface BrowseSidebarProps {
  topics: readonly Topic[];
  categories: readonly Category[];
  /** 当前选中的专题，'' 表示全不选。 */
  topicId: string;
  /** 当前选中的游戏类型（可多选，空集即“全部”）。 */
  selectedCategories: readonly string[];
  onTopicChange: (id: string) => void;
  onToggleCategory: (id: string) => void;
}

/**
 * 浏览页右侧筛选栏：上方为专题（单选，含全不选），下方为游戏类型（复选框平铺）。
 */
export function BrowseSidebar({
  topics,
  categories,
  topicId,
  selectedCategories,
  onTopicChange,
  onToggleCategory,
}: BrowseSidebarProps) {
  return (
    <aside className="browse-aside" aria-label="筛选">
      <section className="filter-group" aria-label="专题筛选">
        <h2 className="filter-group-title">专题</h2>
        <ul className="filter-options">
          {topics.map((topic) => {
            const checked = topic.id === topicId;
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  className={checked ? 'filter-option is-checked' : 'filter-option'}
                  aria-pressed={checked}
                  onClick={() => onTopicChange(topic.id)}
                >
                  <span className="filter-box" aria-hidden="true">
                    {checked && (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {topic.label}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="filter-group" aria-label="游戏类型筛选">
        <h2 className="filter-group-title">游戏类型</h2>
        <ul className="filter-options">
          {categories.map((category) => {
            const checked = selectedCategories.includes(category.id);
            return (
              <li key={category.id}>
                <label className={checked ? 'filter-option is-checked' : 'filter-option'}>
                  <input
                    type="checkbox"
                    className="filter-checkbox"
                    checked={checked}
                    onChange={() => onToggleCategory(category.id)}
                  />
                  <span className="filter-box" aria-hidden="true">
                    {checked && (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {category.label}
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
