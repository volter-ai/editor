/* Native Output channels and Problems markers. Packages supply text and source facts;
 * Code-OSS owns their rendering, navigation, clearing and panel placement. */
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IMarkerData, IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Extensions, IOutputChannelRegistry, IOutputService } from '../../../services/output/common/output.js';

interface Diagnostic {
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
	readonly severity: 'error' | 'warning';
}
export interface VgaiOutputBridge {
	setProvider(provider: {
		write(id: string, label: string, text: string, diagnostics: readonly Diagnostic[]): void;
		show(id: string): void;
	} | null): void;
}
export class VgaiOutput extends Disposable {
	constructor(
		bridge: VgaiOutputBridge,
		@IOutputService output: IOutputService,
		@IMarkerService markers: IMarkerService,
		@IWorkspaceContextService workspace: IWorkspaceContextService,
	) {
		super();
		const channels = Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels);
		const texts = new Map<string, string>();
		const channelId = (id: string) => `vgai.${id}`;
		bridge.setProvider({
			write: (id, label, text, diagnostics) => {
				const key = channelId(id);
				if (!channels.getChannel(key)) { channels.registerChannel({ id: key, label, log: false }); }
				const channel = output.getChannel(key);
				const previous = texts.get(key) ?? '';
				if (text.startsWith(previous)) { channel?.append(text.slice(previous.length)); }
				else { channel?.replace(text); }
				texts.set(key, text);
				const folder = workspace.getWorkspace().folders[0];
				const grouped = new Map<string, IMarkerData[]>();
				for (const diagnostic of diagnostics) {
					const items = grouped.get(diagnostic.path) ?? [];
					items.push({ message: diagnostic.message, source: label,
						severity: diagnostic.severity === 'error' ? MarkerSeverity.Error : MarkerSeverity.Warning,
						startLineNumber: diagnostic.line, startColumn: diagnostic.column,
						endLineNumber: diagnostic.line, endColumn: diagnostic.column + 1 });
					grouped.set(diagnostic.path, items);
				}
				markers.changeAll(key, folder ? [...grouped].flatMap(([path, items]) => items.map(marker => ({ resource: folder.toResource(path), marker }))) : []);
			},
			show: id => { void output.showChannel(channelId(id), true); },
		});
		this._register(toDisposable(() => {
			bridge.setProvider(null);
			for (const id of texts.keys()) { markers.changeAll(id, []); output.getChannel(id)?.dispose(); channels.removeChannel(id); }
		}));
	}
}
