import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/SiteHeader';
import { EmptyState } from '../components/EmptyState';
import { savesApi } from '../lib/api';
import { ApiError } from '../lib/api';
import type { SaveGameGroup, SaveSlotMeta } from '../lib/api';
import { useAuth } from '../state/auth';
import { GAMES } from '../data';

function gameTitle(slug: string): string {
  return GAMES.find((game) => game.slug === slug)?.title ?? slug;
}

function formatSize(size: number | null): string {
  if (size === null) return '—';
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** 删除后本地同步:过滤该槽位,游戏空组整组移除(服务端删除幂等,失败时回滚重取)。 */
function withoutSlot(groups: SaveGameGroup[], slug: string, key: string): SaveGameGroup[] {
  return groups
    .map((group) =>
      group.slug === slug ? { ...group, slots: group.slots.filter((slot) => slot.key !== key) } : group,
    )
    .filter((group) => group.slots.length > 0);
}

/**
 * 存档管理:按游戏分组的存档槽位列表(键名/大小/更新时间,值对平台不透明),
 * 支持删除单条存档;删除幂等,失败时重新拉取兜底。
 */
export function SavesPage() {
  const { status } = useAuth();
  const [groups, setGroups] = useState<SaveGameGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'user') return;
    let cancelled = false;
    savesApi
      .listAll()
      .then((data) => {
        if (!cancelled) setGroups(data.games);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : '存档加载失败,请稍后再试');
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="page profile-page">
        <SiteHeader />
        <main className="profile-main">
          <EmptyState title="正在加载…" detail="正在确认登录状态。" />
        </main>
      </div>
    );
  }

  if (status !== 'user') {
    return (
      <div className="page profile-page">
        <SiteHeader />
        <main className="profile-main">
          <EmptyState
            title="登录后查看存档"
            detail="存档按游戏隔离,登录后可在这里查看与管理。"
            action={
              <Link className="btn btn-secondary" to="/">
                返回首页
              </Link>
            }
          />
        </main>
      </div>
    );
  }

  const remove = async (slug: string, slot: SaveSlotMeta) => {
    if (removing) return;
    const marker = `${slug}/${slot.key}`;
    setRemoving(marker);
    setActionError(null);
    try {
      await savesApi.remove(slug, slot.key);
      setGroups((current) => (current ? withoutSlot(current, slug, slot.key) : current));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : '删除失败,请稍后再试');
      // 失败时以服务端为准重新拉取,避免本地视图与服务端漂移。
      savesApi
        .listAll()
        .then((data) => setGroups(data.games))
        .catch(() => {});
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="page profile-page">
      <SiteHeader />
      <main className="profile-main">
        <section className="profile-card saves-card">
          <h1 className="profile-page-title">存档</h1>
          {loadError ? (
            <EmptyState title="存档加载失败" detail={loadError} />
          ) : groups === null ? (
            <p className="saves-loading">正在加载存档…</p>
          ) : groups.length === 0 ? (
            <EmptyState
              title="暂无存档"
              detail="在游戏中保存进度后,会按游戏展示在这里。"
              action={
                <Link className="btn btn-secondary" to="/">
                  去玩游戏
                </Link>
              }
            />
          ) : (
            <div className="saves-groups">
              {groups.map((group) => (
                <div className="saves-group" key={group.slug}>
                  <h2 className="saves-group-title">{gameTitle(group.slug)}</h2>
                  <ul className="saves-list">
                    {group.slots.map((slot) => {
                      const marker = `${group.slug}/${slot.key}`;
                      return (
                        <li className="saves-row" key={slot.key}>
                          <span className="saves-key" title={slot.key}>
                            {slot.key}
                          </span>
                          <span className="saves-meta">{formatSize(slot.size)}</span>
                          <span className="saves-meta">{formatTime(slot.updatedAt)}</span>
                          <button
                            type="button"
                            className="btn-link saves-remove"
                            onClick={() => void remove(group.slug, slot)}
                            disabled={removing !== null}
                          >
                            {removing === marker ? '删除中…' : '删除'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {actionError && (
                <p className="form-error" role="alert">
                  {actionError}
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
