import React from 'react';
import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	Outlet,
} from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { FilterProvider } from './hooks/useGlobalFilters';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import './index.css';

// Lazy page imports (real pages will replace stubs in later tasks)
const OverviewPage = React.lazy(() =>
	import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const TasksPage = React.lazy(() =>
	import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const TimeEntriesPage = React.lazy(() =>
	import('./pages/TimeEntriesPage').then((m) => ({
		default: m.TimeEntriesPage,
	})),
);
const MissingRatesPage = React.lazy(() =>
	import('./pages/MissingRatesPage').then((m) => ({
		default: m.MissingRatesPage,
	})),
);
const AssigneeRatesPage = React.lazy(() =>
	import('./pages/AssigneeRatesPage').then((m) => ({
		default: m.AssigneeRatesPage,
	})),
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

function ProtectedRoute() {
	const key = localStorage.getItem('adminApiKey');
	if (!key) return <Navigate to="/login" replace />;
	return <Outlet />;
}

const Fallback = <div className="p-6 text-(--text-muted)">Loading…</div>;

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<FilterProvider>
				<BrowserRouter>
					<Routes>
						<Route path="/login" element={<LoginPage />} />
						<Route element={<ProtectedRoute />}>
							<Route element={<AppLayout />}>
								<Route index element={<Navigate to="/overview" replace />} />
								<Route
									path="/overview"
									element={
										<React.Suspense fallback={Fallback}>
											<OverviewPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/tasks"
									element={
										<React.Suspense fallback={Fallback}>
											<TasksPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/tasks/:taskId"
									element={
										<React.Suspense fallback={Fallback}>
											<TasksPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/time-entries"
									element={
										<React.Suspense fallback={Fallback}>
											<TimeEntriesPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/missing-rates"
									element={
										<React.Suspense fallback={Fallback}>
											<MissingRatesPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/assignee-rates"
									element={
										<React.Suspense fallback={Fallback}>
											<AssigneeRatesPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/spaces"
									element={
										<React.Suspense fallback={Fallback}>
											<SpacesPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/sync-logs"
									element={
										<React.Suspense fallback={Fallback}>
											<SyncLogsPage />
										</React.Suspense>
									}
								/>
								<Route
									path="/settings"
									element={
										<React.Suspense fallback={Fallback}>
											<SettingsPage />
										</React.Suspense>
									}
								/>
							</Route>
						</Route>
						<Route path="*" element={<Navigate to="/overview" replace />} />
					</Routes>
				</BrowserRouter>
			</FilterProvider>
		</QueryClientProvider>
	);
}
