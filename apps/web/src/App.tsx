import React from 'react';
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	Outlet,
	useLocation,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { FilterProvider } from './hooks/useGlobalFilters';
import { ToastProvider } from './components/ui/Toast';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { useAuth } from './hooks/useAuth';
import { RequireRole, RequireAccess } from './components/RequireRole';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/ui/PageSkeleton';
import './index.css';

// Lazy page imports — each route's code is split into its own chunk and loaded
// on demand behind <SuspenseRoute>.
const OverviewPage = React.lazy(() =>
	import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const AnalyticsPage = React.lazy(() =>
	import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
);
const HourSpikesPage = React.lazy(() =>
	import('./pages/HourSpikesPage').then((m) => ({ default: m.HourSpikesPage })),
);
const TasksPage = React.lazy(() =>
	import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const SprintsPage = React.lazy(() =>
	import('./pages/SprintsPage').then((m) => ({ default: m.SprintsPage })),
);
const TimeEntriesPage = React.lazy(() =>
	import('./pages/TimeEntriesPage').then((m) => ({
		default: m.TimeEntriesPage,
	})),
);
const TimesheetPage = React.lazy(() =>
	import('./pages/TimesheetPage').then((m) => ({ default: m.TimesheetPage })),
);
const MissingRatesPage = React.lazy(() =>
	import('./pages/MissingRatesPage').then((m) => ({
		default: m.MissingRatesPage,
	})),
);
const ChargeabilityRulesPage = React.lazy(() =>
	import('./pages/ChargeabilityRulesPage').then((m) => ({
		default: m.ChargeabilityRulesPage,
	})),
);
const AssigneeRatesPage = React.lazy(() =>
	import('./pages/AssigneeRatesPage').then((m) => ({
		default: m.AssigneeRatesPage,
	})),
);
const BudgetsPage = React.lazy(() =>
	import('./pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })),
);
const SpacesPage = React.lazy(() =>
	import('./pages/SpacesPage').then((m) => ({ default: m.SpacesPage })),
);
const SyncLogsPage = React.lazy(() =>
	import('./pages/SyncLogsPage').then((m) => ({ default: m.SyncLogsPage })),
);
const SettingsPage = React.lazy(() =>
	import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AuditLogPage = React.lazy(() =>
	import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const UsersPage = React.lazy(() =>
	import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const WorkPage = React.lazy(() =>
	import('./pages/WorkPage').then((m) => ({ default: m.WorkPage })),
);
const NotFoundPage = React.lazy(() =>
	import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);
const SignupPage = React.lazy(() =>
	import('./pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const AccountPage = React.lazy(() =>
	import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })),
);
const ForgotPasswordPage = React.lazy(() =>
	import('./pages/ForgotPasswordPage').then((m) => ({
		default: m.ForgotPasswordPage,
	})),
);
const ResetPasswordPage = React.lazy(() =>
	import('./pages/ResetPasswordPage').then((m) => ({
		default: m.ResetPasswordPage,
	})),
);
const AcceptInvitePage = React.lazy(() =>
	import('./pages/AcceptInvitePage').then((m) => ({
		default: m.AcceptInvitePage,
	})),
);
const FinancePage = React.lazy(() =>
	import('./pages/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const TeamsPage = React.lazy(() =>
	import('./pages/TeamsPage').then((m) => ({ default: m.TeamsPage })),
);
const MyTeamPage = React.lazy(() =>
	import('./pages/MyTeamPage').then((m) => ({ default: m.MyTeamPage })),
);

function PageLoader() {
	return (
		<div
			role="status"
			aria-label="Loading"
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				minHeight: '60vh',
				width: '100%',
			}}
		>
			<span
				className="cc-spin"
				style={{
					width: 28,
					height: 28,
					borderRadius: '50%',
					border: '2.5px solid var(--border)',
					borderTopColor: 'var(--accent)',
					display: 'inline-block',
				}}
			/>
		</div>
	);
}

/**
 * Wraps a routed page in a per-route error boundary + Suspense. The boundary is
 * keyed by pathname so navigating to a different route mounts a fresh boundary
 * (a crash on one page never sticks to the next), while the sidebar/topbar in
 * AppLayout stay mounted and usable. The Suspense fallback is a page-shaped
 * skeleton rather than a bare spinner.
 */
function SuspenseRoute({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	return (
		<ErrorBoundary key={pathname}>
			<React.Suspense fallback={<PageSkeleton />}>{children}</React.Suspense>
		</ErrorBoundary>
	);
}

// Public (pre-auth) routes can't show the app skeleton meaningfully, so they
// keep the lightweight centered spinner.
const PublicFallback = <PageLoader />;

function ProtectedRoute() {
	const { loading, user } = useAuth();
	if (loading) return <PageLoader />;
	if (!user) return <Navigate to="/login" replace />;
	return <Outlet />;
}

export default function App() {
	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<ToastProvider>
					<FilterProvider>
						<BrowserRouter>
							<Routes>
								<Route path="/login" element={<LoginPage />} />
								<Route
									path="/signup"
									element={
										<React.Suspense fallback={PublicFallback}>
											<SignupPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/forgot"
									element={
										<React.Suspense fallback={PublicFallback}>
											<ForgotPasswordPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/reset/:token"
									element={
										<React.Suspense fallback={PublicFallback}>
											<ResetPasswordPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/invite/:token"
									element={
										<React.Suspense fallback={PublicFallback}>
											<AcceptInvitePage />
										</React.Suspense>
									}
								/>
								<Route element={<ProtectedRoute />}>
									<Route element={<AppLayout />}>
										<Route index element={<Navigate to="/overview" replace />} />
										<Route path="/overview" element={<SuspenseRoute><OverviewPage /></SuspenseRoute>} />
										<Route
											path="/analytics"
											element={
												<RequireAccess when={(a) => a.canSeeCost} redirect="/overview">
													<SuspenseRoute><AnalyticsPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route
											path="/time-spikes"
											element={
												<RequireAccess when={(a) => a.unrestricted} redirect="/overview">
													<SuspenseRoute><HourSpikesPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route path="/tasks" element={<SuspenseRoute><TasksPage /></SuspenseRoute>} />
										<Route path="/work" element={<SuspenseRoute><WorkPage /></SuspenseRoute>} />
										<Route
											path="/sprints"
											element={
												<RequireAccess when={(a) => a.canSeeSprints} redirect="/overview">
													<SuspenseRoute><SprintsPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route path="/time-entries" element={<SuspenseRoute><TimeEntriesPage /></SuspenseRoute>} />
										<Route path="/timesheet" element={<SuspenseRoute><TimesheetPage /></SuspenseRoute>} />
										<Route
											path="/missing-rates"
											element={
												<RequireAccess when={(a) => a.unrestricted} redirect="/overview">
													<SuspenseRoute><MissingRatesPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route
											path="/assignee-rates"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><AssigneeRatesPage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										<Route
											path="/chargeability-rules"
											element={
												<RequireAccess when={(a) => a.canEditChargeability} redirect="/overview">
													<SuspenseRoute><ChargeabilityRulesPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route
											path="/budgets"
											element={
												<RequireAccess when={(a) => a.canSeeCost} redirect="/overview">
													<SuspenseRoute><BudgetsPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route
											path="/finance"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><FinancePage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										<Route path="/spaces" element={<SuspenseRoute><SpacesPage /></SuspenseRoute>} />
										<Route
											path="/sync-logs"
											element={
												<RequireAccess when={(a) => a.unrestricted} redirect="/overview">
													<SuspenseRoute><SyncLogsPage /></SuspenseRoute>
												</RequireAccess>
											}
										/>
										<Route
											path="/users"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><UsersPage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										{/* Old link/bookmark for the org-users page (renamed from
										    "Team" to "Users" to stop colliding with team-scoped
										    "Teams"/"My team"). Guarded the same as the real route so a
										    non-admin still bounces to /overview instead of learning
										    /users exists. */}
										<Route
											path="/team"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<Navigate to="/users" replace />
												</RequireRole>
											}
										/>
										<Route
											path="/teams"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><TeamsPage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										<Route path="/my-team" element={<SuspenseRoute><MyTeamPage /></SuspenseRoute>} />
										{/* Open to every role: Settings is Admin-only, so this is where a
										    member changes their own password. */}
										<Route path="/account" element={<SuspenseRoute><AccountPage /></SuspenseRoute>} />
										<Route
											path="/audit-log"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><AuditLogPage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										<Route
											path="/settings"
											element={
												<RequireRole min="ADMIN" redirect="/overview">
													<SuspenseRoute><SettingsPage /></SuspenseRoute>
												</RequireRole>
											}
										/>
										{/* Unknown in-app path: show a real 404 (with nav chrome)
										    instead of silently bouncing to /overview. */}
										<Route path="*" element={<SuspenseRoute><NotFoundPage /></SuspenseRoute>} />
									</Route>
								</Route>
							</Routes>
						</BrowserRouter>
					</FilterProvider>
				</ToastProvider>
			</QueryClientProvider>
		</ErrorBoundary>
	);
}
