interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <input
      className="search-input"
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="搜索游戏名称"
      aria-label="搜索游戏名称"
    />
  );
}
