/* Preserve the native saved sidebar selection in the packaged workbench.
 * Code-OSS 1.138 layout.ts deliberately substitutes the default container on a
 * cold built launch (but not in development or Reload Window). Consequently a
 * saved Model container silently becomes Explorer. Capture the native key
 * before restoration overwrites it and reopen that same native container after
 * restoration. No parallel layout store, product-specific ID or forced views.
 */
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { SidebarPart } from '../../../browser/parts/sidebar/sidebarPart.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

class VgaiSidebarRestore implements IWorkbenchContribution {
	constructor(
		@IStorageService storage: IStorageService,
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IViewsService views: IViewsService,
	) {
		const saved = storage.get(SidebarPart.activeViewletSettingsKey, StorageScope.WORKSPACE);
		if (!saved) { return; }
		void layout.whenRestored.then(async () => {
			if (!layout.isVisible(Parts.SIDEBAR_PART)) { return; }
			const container = descriptors.getViewContainerById(saved);
			if (!container || descriptors.getViewContainerLocation(container) !== ViewContainerLocation.Sidebar) { return; }
			if (!descriptors.getViewContainerModel(container).activeViewDescriptors.length) { return; }
			await views.openViewContainer(saved, false);
		}).catch(onUnexpectedError);
	}
}

registerWorkbenchContribution2('vgai.sidebarRestore', VgaiSidebarRestore, WorkbenchPhase.BlockStartup);
