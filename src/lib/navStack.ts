import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 站内导航栈：按访问顺序记录位置，供层级式返回计算"回到上级需要后退几步"。
 * 前进/后退的识别依据 react-router 的 location.key——每次导航生成唯一 key，
 * 后退/前进会复用旧 key；据此在栈中定位并截断，避免盲目 navigate(-1)
 * 退到运行页等非上级页面。
 */
type Entry = { key: string; path: string };

const stack: Entry[] = [];

/** 详情页的层级上级：浏览页（含筛选参数）。 */
export const isBrowsePath = (path: string) => path === '/browse' || path.startsWith('/browse?');

/** 每次路由变化时调用（App 内监听 location）。 */
export function trackNavigation(key: string, path: string) {
  const last = stack[stack.length - 1];
  if (last?.key === key) {
    last.path = path; // replace 导航：原地更新
    return;
  }
  const pos = stack.findIndex((entry) => entry.key === key);
  if (pos >= 0) {
    stack.length = pos + 1; // 后退/前进到已记录位置：截断其后的记录
  } else {
    stack.push({ key, path });
  }
}

/** 自当前位置向历史回溯，找最近的上级位置；返回需后退的步数，没有则 null。 */
export function backStepsToParent(isParent: (path: string) => boolean): number | null {
  for (let i = stack.length - 2; i >= 0; i--) {
    if (isParent(stack[i].path)) return stack.length - 1 - i;
  }
  return null;
}

/** 测试用：清空导航栈。 */
export function resetNavStack() {
  stack.length = 0;
}

/**
 * 层级式返回：后退到历史中最近的浏览页位置（保留其筛选状态）；
 * 历史中没有浏览页记录（直接打开详情、或从探索页进入且中途未经过浏览页）时
 * 直达浏览页并替换当前记录，使浏览器后退回到进入详情前的位置。
 */
export function useBackToParent() {
  const navigate = useNavigate();
  return useCallback(() => {
    const steps = backStepsToParent(isBrowsePath);
    if (steps !== null) navigate(-steps);
    else navigate('/browse', { replace: true });
  }, [navigate]);
}

