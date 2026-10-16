import { strings, useAdminResource } from "@clientbridge/app-core/public";
import { Panel } from "@clientbridge/ui";
import { config } from "../config";
import { Facts, Identifier, Resource } from "../components/Records";

export function Access() {
    const state = useAdminResource("AdminAccessInfo", config.apiUrl, "access");
    return (
        <Resource state={state}>
            {(data) => (
                <Panel title={data.email} subtitle={strings.admin.environment}>
                    <Facts
                        items={[
                            [strings.admin.identity, <Identifier value={data.identity_id} />],
                            [strings.admin.environmentLabel, data.environment],
                            [
                                strings.admin.grant,
                                data.development_grant
                                    ? strings.admin.devGrant
                                    : strings.admin.configuredGrant,
                            ],
                            [
                                strings.admin.secondFactor,
                                data.second_factor ? strings.admin.yes : strings.admin.no,
                            ],
                        ]}
                    />
                    <p className="pt-4 text-sm text-muted">{strings.admin.accessNote}</p>
                </Panel>
            )}
        </Resource>
    );
}
