import type { Category } from '../lib/types';
import { ALL_CATEGORY } from '../lib/browse';

interface CategoryFilterProps {
  categories: readonly Category[];
  value: string;
  onChange: (id: string) => void;
}

export function CategoryFilter({ categories, value, onChange }: CategoryFilterProps) {
  const options = [{ id: ALL_CATEGORY, label: '全部' }, ...categories];
  return (
    <div className="category-filter" role="group" aria-label="分类筛选">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === value ? 'chip chip-active' : 'chip'}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
