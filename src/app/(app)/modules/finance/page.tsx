import { redirect } from "next/navigation";
import { FinanceManager } from "@/components/finance-manager";
import { TransactionsManager } from "@/components/transactions-manager";
import { CashSessionsManager } from "@/components/cash-sessions-manager";
import { AccountTransfersManager } from "@/components/account-transfers-manager";
import { FinanceCategoriesManager } from "@/components/finance-categories-manager";
import { FinanceBudgetsManager } from "@/components/finance-budgets-manager";
import { FinanceOperationsManager } from "@/components/finance-operations-manager";
import { EmergencyFundManager } from "@/components/emergency-fund-manager";
import { PurchaseRequestsManager } from "@/components/purchase-requests-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { hasAnyPermission } from "@/lib/permissions";

export default async function FinancePage() {
  const user = await getSession();
  if (!user) redirect("/login");
  const canReadAccounts = hasAnyPermission(user, ["finance.transaction.read", "finance.transaction.create", "finance.account.manage"]);
  const canManageAccounts = hasAnyPermission(user, ["finance.account.manage"]);
  const canReadBudgets = hasAnyPermission(user, ["finance.budget.read", "finance.budget.manage"]);
  const canManageBudgets = hasAnyPermission(user, ["finance.budget.manage"]);
  const canAccessEmergencyFund = hasAnyPermission(user, [
    "finance.fund.read",
    "finance.fund.contribute",
    "finance.fund.request_withdrawal",
    "finance.fund.approve_withdrawal",
    "finance.fund.set_rate",
    "finance.account.manage",
  ]);
  const canManageRates = hasPermission(user, "finance.rate.manage");
  const canAccessTransactions = hasAnyPermission(user, [
    "finance.transaction.read",
    "finance.transaction.create",
    "finance.transaction.validate",
    "finance.transaction.reverse",
  ]);
  const canCreateTransactions = hasAnyPermission(user, ["finance.transaction.create"]);
  if (!canReadAccounts && !canManageRates && !canAccessTransactions && !canReadBudgets && !canAccessEmergencyFund) redirect("/forbidden");

  return (
    <div className="admin-page operations-shell">
      <header className="operations-header">
        <div>
          <span className="eyebrow">{translate(user.locale, "finance").toUpperCase()}</span>
          <h1>Comptabilité & trésorerie</h1>
          <p>{translate(user.locale, "financeManagementDescription")}</p>
        </div>
      </header>
      <FinanceManager locale={user.locale} canReadAccounts={canReadAccounts} canManageRates={canManageRates} />
      {canAccessEmergencyFund && <EmergencyFundManager locale={user.locale} />}
      <FinanceBudgetsManager locale={user.locale} canRead={canReadBudgets} canManage={canManageBudgets} />
      <FinanceCategoriesManager locale={user.locale} canManage={canManageAccounts} />
      <CashSessionsManager
        locale={user.locale}
        canAccess={canReadAccounts || canAccessTransactions}
        canManage={canCreateTransactions}
      />
      <AccountTransfersManager locale={user.locale} canManage={canCreateTransactions} />
      <TransactionsManager locale={user.locale} canAccess={canAccessTransactions} canCreate={canCreateTransactions} />
      {canCreateTransactions && <PurchaseRequestsManager locale={user.locale} />}
      <FinanceOperationsManager
        locale={user.locale}
        canAccess={canAccessTransactions}
        canCreate={canCreateTransactions}
      />
    </div>
  );
}
