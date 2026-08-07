import Link from 'next/link';
import { Badge } from '@/common/components/badge';
import { Stack } from '@/common/components/layout';
import { getPlatformFoundationStatus } from '../platform-foundation.api';
import { buildPlatformFoundationViewModel } from '../platform-foundation.logic';
import styles from './PlatformFoundationPage.module.css';

export async function PlatformFoundationPage() {
  const statusItems = await getPlatformFoundationStatus();
  const viewModel = buildPlatformFoundationViewModel(statusItems);

  return (
    <main className={styles.main}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Stack className={styles.brand} gap={1}>
            <h1>{viewModel.title}</h1>
            <p>{viewModel.subtitle}</p>
          </Stack>
        </header>

        <section className={styles.status} aria-label="Foundation status">
          {viewModel.statusItems.map((check) => (
            <div className={styles.statusCard} key={check.label}>
              <strong>{check.label}</strong>
              <div className={styles.statusMeta}>
                <Badge variant={check.status}>{check.status}</Badge>
                {check.href ? (
                  <Link className={styles.statusLink} href={check.href}>
                    {check.actionLabel ?? 'Open'}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
