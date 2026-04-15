import { IntelPanel } from './panel-base';

type PanelFactory = (container: HTMLElement) => IntelPanel;

export class PanelRegistry {
  private factories: PanelFactory[] = [];
  private instances: IntelPanel[] = [];

  register(factory: PanelFactory): void {
    this.factories.push(factory);
  }

  mount(container: HTMLElement): IntelPanel[] {
    this.destroyAll();
    container.innerHTML = '';
    for (const factory of this.factories) {
      const panel = factory(container);
      const el = panel.render();
      container.appendChild(el);
      panel.startPolling();
      this.instances.push(panel);
    }
    return this.instances;
  }

  getInstances(): readonly IntelPanel[] {
    return this.instances;
  }

  find<T extends IntelPanel>(id: string): T | undefined {
    return this.instances.find((p) => p.id === id) as T | undefined;
  }

  destroyAll(): void {
    for (const p of this.instances) p.destroy();
    this.instances = [];
  }
}

export const panelRegistry = new PanelRegistry();
