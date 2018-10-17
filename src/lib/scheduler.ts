import { IGlobalDB, IWebService, IService, INodeWithServices, Configuration } from '@dockate/commons';
import { ILogger, LoggerFactory } from '@log4js-universal/logger';
import { Dictionnary } from 'arrayplus';
import { DockerAPI, IServiceInfos } from './get-docker-infos';

export class Scheduler {
    private static LOGGER: ILogger = LoggerFactory.getLogger("dockate-core.Scheduler");
    private lastDbCalculed: IGlobalDB = null;
    private api: DockerAPI = new DockerAPI();

    public constructor(
        private webService: IWebService
    ) {

    }

    public start() {
        Scheduler.LOGGER.debug("Scheduler started");
        Configuration.INSTANCE.getConfig().then((config) => {
            const intervalBetweenCheckServices = config.intervalBetweenCheckServices;
            const callbackRun = () => {
                // Ignore errors!
                this.execute().catch((e) => {
                    console.error(e);
                    this.lastDbCalculed = null;
                }).then(() => {
                    if (intervalBetweenCheckServices > 0) {
                        setTimeout(() => {
                            callbackRun();
                        }, intervalBetweenCheckServices);
                    } else {
                        Scheduler.LOGGER.debug("Scheduler ended because config.intervalBetweenCheckServices is <= 0 : %1", intervalBetweenCheckServices);
                    }
                });
            }
            callbackRun();
        });
    }

    private configMustBeRecalculed(): Promise<boolean> {
        if (this.lastDbCalculed === null) {
            Scheduler.LOGGER.debug("UPDATE > because no this.lastDbCalculed");
            return Promise.resolve(true);
        }
        return this.api.getServices().then((services) => {
            let servicesFound: number = 0;
            const hasSomeServicesDifferents: boolean = services.some((service) => {
                if (!service.Spec.TaskTemplate.ContainerSpec.Labels['dockate.port']) {
                    Scheduler.LOGGER.debug("Ignore service %1 because no dockate.port detected on labels", service.Spec.Name);
                    // Ignore this service
                    return false;
                }
                Scheduler.LOGGER.debug("Service %1 detected with the internal port %2", service.Spec.Name, service.Spec.TaskTemplate.ContainerSpec.Labels['dockate.port']);
                servicesFound++;
                const serviceFromDb = this.lastDbCalculed.services.getElement(service.Spec.Name)
                if (!serviceFromDb) {
                    Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " not found");
                    return true;
                }
                if (service.Endpoint.VirtualIPs.length !== serviceFromDb.virtualIPs.length) {
                    Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " has virtualips", service.Endpoint.VirtualIPs, "but in the last check: ", serviceFromDb.virtualIPs);
                    return true;
                }
                return service.Endpoint.VirtualIPs.some((virtualIP) => {
                    if (!serviceFromDb.virtualIPs.hasElement(virtualIP.Addr)) {
                        Scheduler.LOGGER.debug("UPDATE > because service", service.Spec.Name, " has virtualips", service.Endpoint.VirtualIPs, "but in the last check: ", serviceFromDb.virtualIPs, "(ip", virtualIP.Addr, " not found)");
                        return true;
                    }
                    return false;
                });
            });
            if (hasSomeServicesDifferents) {
                return hasSomeServicesDifferents;
            }
            if (this.lastDbCalculed.services.length !== servicesFound) {
                // Nb services !==
                Scheduler.LOGGER.debug("UPDATE > because service.length from db is %1 and from api is %2", this.lastDbCalculed.services.length, servicesFound);
                return true;
            }
            return false;
        });
    }

    private execute(): Promise<void> {
        Scheduler.LOGGER.debug("Run execute");
        return this.configMustBeRecalculed().then((mustBeRecalculated) => {
            if (!mustBeRecalculated) {
                Scheduler.LOGGER.debug("Not update necessary");
                return;
            }
            Scheduler.LOGGER.info("Get new swarm configuration");
            const nodesWithService: INodeWithServices[] = [];
            const servicesAll: Dictionnary<string, IService> = Dictionnary.create();

            return Promise.all([
                this.api.getNodes(),
                this.api.getServices()
            ]).then(([nodes, services]) => {
                const promises: Promise<any>[] = [];

                const serviceById: { [key: string]: IServiceInfos } = {};
                services.forEach((service) => {
                    serviceById[service.Spec.Name] = service;
                });
                nodes.forEach((node) => {
                    const nodeWithService: INodeWithServices = {
                        ID: node.ID,
                        NAME: node.Description.Hostname,
                        IP: node.Status.Addr,
                        SERVICES: [],
                    };
                    nodesWithService.push(nodeWithService);
                    promises.push(this.api.getNodePs(node.ID).then((containers) => {
                        containers.forEach((container) => {
                            if (container['DESIRED STATE'] !== 'Running') {
                                return;
                            }
                            let serviceFromDB: IServiceInfos = null;
                            if (!/^(.+)(?:\.[0-9]$)/.test(container.NAME)) {
                                serviceFromDB = serviceById[container.NAME];
                            } else {
                                serviceFromDB = serviceById[/^(.+)(?:\.[0-9]$)/.exec(container.NAME)[1]];
                            }
                            let service: IService = servicesAll.getElement(serviceFromDB.Spec.Name);
                            if (!service) {
                                service = {
                                    NAME: serviceFromDB.Spec.Name,
                                    PORT: {},
                                    domains: [],
                                    paths: [],
                                    authent: [],
                                    nodes: [],
                                    virtualIPs: Dictionnary.create()
                                };
                                serviceFromDB.Endpoint.VirtualIPs.forEach((virtualIp) => {
                                    service.virtualIPs.addElement(virtualIp.Addr, virtualIp.Addr);
                                });
                                if (serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels['dockate.port']) {
                                    const internalPortNumber: number = Number(serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels['dockate.port']);
                                    const externalPort = serviceFromDB.Endpoint.Ports.find((entry) => {
                                        if (entry.TargetPort === internalPortNumber) {
                                            return true;
                                        }
                                        return false;
                                    });
                                    if (externalPort) {
                                        service.PORT[internalPortNumber] = externalPort.PublishedPort;
                                        servicesAll.addElement(serviceFromDB.Spec.Name, service);
                                        const domainsString: string = serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels['dockate.domains'];
                                        if (domainsString) {
                                            service.domains = domainsString.split(',');
                                            Scheduler.LOGGER.debug("Service %1 has the domain list %2", serviceFromDB.Spec.Name, service.domains);
                                        }
                                        const pathsString: string = serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels['dockage.paths'];
                                        if (pathsString) {
                                            service.paths = pathsString.split(',');
                                            Scheduler.LOGGER.debug("Service %1 has the paths list %2", serviceFromDB.Spec.Name, service.paths);
                                        }
                                        const authentString: string = serviceFromDB.Spec.TaskTemplate.ContainerSpec.Labels['dockage.authents'];
                                        if (authentString) {
                                            service.authent = authentString.split(',');
                                            Scheduler.LOGGER.debug("Service %1 has the authent list %2", serviceFromDB.Spec.Name, service.authent);
                                        }
                                    } else {
                                        Scheduler.LOGGER.debug("Service %1 ignored because no external port found", serviceFromDB.Spec.Name);
                                        service = null;
                                    }
                                } else {
                                    service = null;
                                }
                            }
                            if (service) {
                                service.nodes.push(nodeWithService);
                                nodeWithService.SERVICES.push(service);
                            }
                        });
                    }));
                });
                return Promise.all(promises);
            }).then(() => {
                return this.api.stop();
            }).then(() => {
                this.lastDbCalculed = {
                    nodes: nodesWithService,
                    services: servicesAll
                };
                return this.webService.updateConf(this.lastDbCalculed).then(() => {
                    return this.webService.stop();
                });
            });
        });
    }
}