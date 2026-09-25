import { Code2, Github, Linkedin, Mail } from 'lucide-react';
import { Button, type ButtonSize } from '@/components/ui/Button';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

type Network = 'github' | 'linkedin' | 'leetcode' | 'email';

export type SocialLinksProps = {
  size?: ButtonSize;
  /** Visible names next to the icons. */
  showLabels?: boolean;
  include?: Network[];
  className?: string;
};

const NETWORKS: Record<Network, { name: string; href: string; Icon: typeof Github; external: boolean }> = {
  github: { name: 'GitHub', href: SITE.links.github, Icon: Github, external: true },
  linkedin: { name: 'LinkedIn', href: SITE.links.linkedin, Icon: Linkedin, external: true },
  leetcode: { name: 'LeetCode', href: SITE.links.leetcode, Icon: Code2, external: true },
  email: { name: 'Email', href: SITE.mailtoHref, Icon: Mail, external: false },
};

/** Labelled icon Buttons (44px hit area) for the profile links. */
export function SocialLinks({
  size = 'md',
  showLabels = false,
  include = ['github', 'linkedin', 'leetcode'],
  className,
}: SocialLinksProps) {
  return (
    <ul data-social-links="" className={cn('flex flex-wrap items-center gap-2', className)}>
      {include.map((key) => {
        const { name, href, Icon, external } = NETWORKS[key];
        const accessibleName = external ? `${name} (opens in new tab)` : name;
        return (
          <li key={key}>
            <Button
              href={href}
              external={external}
              variant={showLabels ? 'secondary' : 'icon'}
              size={size}
              cursor="open"
              aria-label={accessibleName}
              leadingIcon={<Icon aria-hidden="true" className="size-4 shrink-0" />}
            >
              {showLabels ? name : null}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
