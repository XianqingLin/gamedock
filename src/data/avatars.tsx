import type { ReactNode } from 'react';

/**
 * 系统预设头像(内置 SVG,深色主题配色)。
 * 编号 av0~av16 与服务端 server/auth.mjs 的 AVATAR_ID_PATTERN 一一对应:
 * av0 = 「小舟AI」专属,av1~av16 = 用户可选;两侧清单修改必须同步。
 */
export interface AvatarPreset {
  id: string;
  label: string;
  svg: ReactNode;
}

export const PRESET_AVATARS: AvatarPreset[] = [
  {
    id: 'av0',
    label: '小舟AI',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#4fb3a9" />
        <path d="M16.8 5.5v15" stroke="#164041" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M16.2 7c4 1.8 6.2 5.2 6.8 9.5H16.2Z" fill="#f4f4f2" />
        <path d="M6.5 20.5h19l-3.5 5a2 2 0 0 1-1.7 1H11.7a2 2 0 0 1-1.7-1Z" fill="#164041" />
      </>
    ),
  },
  {
    id: 'av1',
    label: '狐狸',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#e8a54e" />
        <path d="M8 5.5l5.5 3.6-5 3.4Z" fill="#3a2a1a" />
        <path d="M24 5.5l-5.5 3.6 5 3.4Z" fill="#3a2a1a" />
        <path d="M7 15a9 9 0 0 1 18 0c0 1.6-.7 3-2 4.2l-4.6 5.6a3.5 3.5 0 0 1-4.8 0L9 19.2C7.7 18 7 16.6 7 15Z" fill="#3a2a1a" />
        <circle cx="12.5" cy="15.5" r="1.3" fill="#f4e3cf" />
        <circle cx="19.5" cy="15.5" r="1.3" fill="#f4e3cf" />
        <path d="M14 20.5h4" stroke="#f4e3cf" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av2',
    label: '熊猫',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#f4f4f2" />
        <circle cx="9" cy="9.5" r="4" fill="#232327" />
        <circle cx="23" cy="9.5" r="4" fill="#232327" />
        <circle cx="16" cy="17.5" r="10" fill="#f4f4f2" stroke="#232327" strokeWidth="1" />
        <ellipse cx="12" cy="16.5" rx="2.8" ry="3.4" fill="#232327" />
        <ellipse cx="20" cy="16.5" rx="2.8" ry="3.4" fill="#232327" />
        <circle cx="12.7" cy="15.8" r="0.9" fill="#f4f4f2" />
        <circle cx="20.7" cy="15.8" r="0.9" fill="#f4f4f2" />
        <path d="M13.5 22.5c1.6 1.3 3.4 1.3 5 0" stroke="#232327" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av3',
    label: '青蛙',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#7cc48f" />
        <circle cx="10" cy="10.5" r="4.6" fill="#24422c" />
        <circle cx="22" cy="10.5" r="4.6" fill="#24422c" />
        <circle cx="10" cy="9.8" r="1.9" fill="#7cc48f" />
        <circle cx="22" cy="9.8" r="1.9" fill="#7cc48f" />
        <ellipse cx="16" cy="20" rx="9.5" ry="7" fill="#24422c" />
        <path d="M11 20.5c1.6 2.2 8.4 2.2 10 0" stroke="#7cc48f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av4',
    label: '机器人',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#9aa4b0" />
        <path d="M16 6.5v3" stroke="#23272e" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="5.5" r="1.7" fill="#23272e" />
        <rect x="8" y="10.5" width="16" height="12.5" rx="3" fill="#23272e" />
        <circle cx="12.5" cy="16" r="1.7" fill="#9ae0c8" />
        <circle cx="19.5" cy="16" r="1.7" fill="#9ae0c8" />
        <path d="M12.5 20h7" stroke="#9aa4b0" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av5',
    label: '太阳',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#f0c05a" />
        <circle cx="16" cy="16" r="5.6" fill="#4a3410" />
        <g stroke="#4a3410" strokeWidth="1.8" strokeLinecap="round">
          <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3M7.2 7.2l2.1 2.1M22.7 22.7l2.1 2.1M24.8 7.2l-2.1 2.1M9.3 22.7l-2.1 2.1" />
        </g>
      </>
    ),
  },
  {
    id: 'av6',
    label: '月亮',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#6a6ad0" />
        <path d="M20.5 4.5A12.3 12.3 0 1 0 27.4 23 10.2 10.2 0 0 1 20.5 4.5Z" fill="#f4f4f2" />
        <circle cx="10.5" cy="9" r="1.1" fill="#f4f4f2" />
        <circle cx="7.5" cy="14.5" r="0.8" fill="#f4f4f2" />
      </>
    ),
  },
  {
    id: 'av7',
    label: '星星',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#4f4f9e" />
        <path d="M16 5.5l3 6.3 6.9.9-5.1 4.8 1.3 6.8-6.1-3.4-6.1 3.4 1.3-6.8-5.1-4.8 6.9-.9Z" fill="#f0d060" />
      </>
    ),
  },
  {
    id: 'av8',
    label: '闪电',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#d4ae76" />
        <path d="M17.8 4L8.6 17.2h5.5L11.8 28l9.6-14.2h-5.9L17.8 4Z" fill="#2b2418" />
      </>
    ),
  },
  {
    id: 'av9',
    label: '叶子',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#4f9e69" />
        <path d="M8.5 23.5C8.5 12.5 15.5 7 25 7c0 9.5-5.5 16.5-14.5 16.5-.7 0-2 0-2 0Z" fill="#eaf4ec" />
        <path d="M9.5 22.5c3.5-6 8-10.5 13-13" stroke="#4f9e69" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av10',
    label: '爱心',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#e07a8a" />
        <path d="M16 26.5S5.5 19.8 5.5 13.2a5.6 5.6 0 0 1 10.5-2.8 5.6 5.6 0 0 1 10.5 2.8c0 6.6-10.5 13.3-10.5 13.3Z" fill="#7a2a34" />
      </>
    ),
  },
  {
    id: 'av11',
    label: '手柄',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#4f8fd9" />
        <rect x="5" y="11" width="22" height="11" rx="5.5" fill="#16233a" />
        <path d="M10 14v5M7.5 16.5h5" stroke="#4f8fd9" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="19.5" cy="14.8" r="1.3" fill="#4f8fd9" />
        <circle cx="22.5" cy="17.8" r="1.3" fill="#4f8fd9" />
      </>
    ),
  },
  {
    id: 'av12',
    label: '幽灵',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#8a7ad0" />
        <path d="M7 27.5V15a9 9 0 0 1 18 0v12.5l-3-2.4-3 2.4-3-2.4-3 2.4Z" fill="#f4f4f2" />
        <circle cx="13" cy="15" r="1.6" fill="#8a7ad0" />
        <circle cx="19" cy="15" r="1.6" fill="#8a7ad0" />
      </>
    ),
  },
  {
    id: 'av13',
    label: '笑脸',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#e8907a" />
        <circle cx="16" cy="16" r="10" fill="#3a241e" />
        <circle cx="12.5" cy="13.5" r="1.5" fill="#e8907a" />
        <circle cx="19.5" cy="13.5" r="1.5" fill="#e8907a" />
        <path d="M11 19c1.6 2.6 8.4 2.6 10 0" stroke="#e8907a" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av14',
    label: '宝石',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#b06ad0" />
        <path d="M10 10h12l4 5.5L16 27 6 15.5Z" fill="#f4eafa" />
        <path d="M6 15.5h20M12.8 10l-1.6 5.5L16 27l4.8-11.5L19.2 10" stroke="#b06ad0" strokeWidth="1.2" fill="none" />
      </>
    ),
  },
  {
    id: 'av15',
    label: '盾牌',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#7a8ab0" />
        <path d="M16 5l9 3v8.2c0 6.4-4.4 10.4-9 12.3-4.6-1.9-9-5.9-9-12.3V8Z" fill="#1e2634" />
        <path d="M16 10v9.5M11.5 14.5h9" stroke="#7a8ab0" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  {
    id: 'av16',
    label: '外星人',
    svg: (
      <>
        <circle cx="16" cy="16" r="16" fill="#6ac47a" />
        <path d="M16 4.5c5.6 0 9.6 3.7 9.6 8.7 0 6.2-6.1 12.8-9.6 13.8-3.5-1-9.6-7.6-9.6-13.8 0-5 4-8.7 9.6-8.7Z" fill="#1e3a26" />
        <ellipse cx="12.2" cy="14.2" rx="2.4" ry="1.6" fill="#6ac47a" transform="rotate(-18 12.2 14.2)" />
        <ellipse cx="19.8" cy="14.2" rx="2.4" ry="1.6" fill="#6ac47a" transform="rotate(18 19.8 14.2)" />
      </>
    ),
  },
];

/** 用户可选预设(av0 为小舟AI 专属,不进选择网格)。 */
export const USER_SELECTABLE_AVATARS = PRESET_AVATARS.filter((preset) => preset.id !== 'av0');

export function getPresetAvatar(id: string): AvatarPreset | null {
  return PRESET_AVATARS.find((preset) => preset.id === id) ?? null;
}
