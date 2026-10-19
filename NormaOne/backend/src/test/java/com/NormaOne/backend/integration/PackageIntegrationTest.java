package com.NormaOne.backend.integration;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.BillingCycle;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionSource;
import com.NormaOne.backend.repositories.PlanDefinitionRepository;
import com.NormaOne.backend.services.PackageService;

class PackageIntegrationTest extends IntegrationTestBase {

    @Autowired
    private PlanDefinitionRepository planRepository;

    @Autowired
    private PackageService packageService;

    @Test
    void basicPackageIsSeededOnceAndMarkedDefault() throws Exception {
        packageInitializer.run(null);
        packageInitializer.run(null);

        List<PlanDefinition> plans = mongo.find(new Query(Criteria.where("planCode").is("BASIC")), PlanDefinition.class);
        assertEquals(1, plans.size());
        PlanDefinition basic = plans.get(0);
        assertEquals("Basic", basic.getName());
        assertEquals(PlanStatus.ACTIVE, basic.getStatus());
        assertTrue(basic.getDefaultPlan());
        assertEquals(0, basic.getListPrice().compareTo(BigDecimal.ZERO));
        assertEquals("EUR", basic.getCurrencyCode());
        assertEquals(1, basic.getPlanVersion());
    }

    @Test
    void restartDoesNotOverwriteAdministratorChanges() throws Exception {
        mongo.updateFirst(new Query(Criteria.where("planCode").is("BASIC")),
                new Update().set("name", "Basic (edited)").set("maxEmployees", 25L), PlanDefinition.class);
        packageInitializer.run(null);
        PlanDefinition basic = planRepository.findByPlanCodeAndPlanVersion("BASIC", 1).orElseThrow();
        assertEquals("Basic (edited)", basic.getName());
        assertEquals(25L, basic.getMaxEmployees());
    }

    @Test
    void uniqueIndexesRejectDuplicatePlansAndASecondDefault() {
        PlanDefinition duplicate = PlanDefinition.builder().planCode("BASIC").planVersion(1).name("Copy")
                .billingCycle(BillingCycle.MONTHLY).listPrice(BigDecimal.ZERO).maxEmployees(1L).status(PlanStatus.DRAFT).build();
        assertThrows(DuplicateKeyException.class, () -> planRepository.insert(duplicate));

        PlanDefinition secondDefault = PlanDefinition.builder().planCode("PRO").planVersion(1).name("Pro")
                .billingCycle(BillingCycle.MONTHLY).listPrice(BigDecimal.TEN).maxEmployees(50L)
                .status(PlanStatus.DRAFT).defaultPlan(true).build();
        assertThrows(DuplicateKeyException.class, () -> planRepository.insert(secondDefault));
    }

    @Test
    void concurrentAssignmentsCreateASingleCurrentSubscription() throws Exception {
        Tenant tenant = mongo.insert(tenant("concurrent"));
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Future<String>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < 8; i++) {
                futures.add(pool.submit(() -> packageService.assignDefaultPackage(tenant.getId(), SubscriptionSource.ONBOARDING, "test").getId()));
            }
            String first = futures.get(0).get();
            for (Future<String> f : futures) {
                assertEquals(first, f.get());
            }
        } finally {
            pool.shutdown();
        }
        assertEquals(1, mongo.count(new Query(Criteria.where("tenantId").is(tenant.getId())), TenantSubscription.class));
    }

    @Test
    void existingTenantsWithoutPackageAreBackfilledOnce() throws Exception {
        Tenant legacy = mongo.insert(tenant("legacy"));
        packageInitializer.run(null);
        packageInitializer.run(null);
        List<TenantSubscription> subs = mongo.find(new Query(Criteria.where("tenantId").is(legacy.getId())), TenantSubscription.class);
        assertEquals(1, subs.size());
        assertEquals(SubscriptionSource.BACKFILL, subs.get(0).getAssignmentSource());
        assertEquals("BASIC", subs.get(0).getPlanCode());
    }

    private static Tenant tenant(String subdomain) {
        return Tenant.builder().tenantName(subdomain).accountHolderName("Holder").subdomain(subdomain)
                .countryCode(CountryCode.ES).defaultLocale(TenantLocale.ES_ES).defaultTimeZone(TenantTimeZone.EUROPE_MADRID)
                .status(TenantStatus.ACTIVE).activatedAt(Instant.now()).build();
    }
}
