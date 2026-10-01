import { KYC_LABEL, type AdminProfessionalRow } from '../../../../packages/client/src';
import type { Tone } from '@/components/ui';

/** Estado de um profissional para exibição (a mesma regra na lista e no detalhe). */
export function proState(r: Pick<AdminProfessionalRow, 'status' | 'has_profile' | 'kyc_status'>): { tone: Tone; label: string } {
  if (r.status === 'suspended') return { tone: 'bad', label: 'Suspenso' };
  if (!r.has_profile) return { tone: 'wait', label: KYC_LABEL.incomplete! };
  if (r.kyc_status === 'approved') return { tone: 'ok', label: 'Aprovado' };
  if (r.kyc_status === 'rejected') return { tone: 'bad', label: 'Reprovado' };
  return { tone: 'wait', label: KYC_LABEL[r.kyc_status ?? 'pending'] ?? 'Aguardando verificação' };
}
